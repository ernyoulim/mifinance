const express = require("express");
const dotenv = require("dotenv");
const helpers = require("./helpers");
var bodyParser = require("body-parser");
var session = require("express-session");
var pg = require("pg");
var urlencodedParser = bodyParser.urlencoded({
    extended: false
});

const conString = process.env.DB_CON_STRING;

if (conString == undefined) {
    console.log("ERROR: environment variable DB_CON_STRING not set.");
    process.exit(1);
}
const dbConfig = {
  connectionString: conString,
  ssl: { rejectUnauthorized: false }
}

var dbClient = new pg.Client(dbConfig);
dbClient.connect();

/* Reading global variables from config file */
dotenv.config();
const PORT = process.env.PORT;

/*
 *
 * Express setup
 *
*/

app = express();
app.use(session({
    secret: "This is a secret!",
    resave: true,
    saveUninitialized: true
}));


//turn on serving static files (required for delivering css to client)
app.use(express.static("public"));
//configure template engine
app.set("views", "views");
app.set("view engine", "pug");

app.get('/', function(req,res) {
  if (req.session.user != undefined){
    var user = req.session.user.userId
    var latestPrice = new Array();
    var gesamt = new Array();
    var total = 0.00;
    dbClient.query("SELECT symbol, SUM(count) AS count , name FROM finance_transactions WHERE account_id=$1 GROUP BY symbol, name HAVING SUM(count) > 0", [user], async(dbError,dbResponse) => {
      number = dbResponse.rows.length
      try {
        for (var i = 0; i < number; i++) {
          let result = await helpers.lookup(dbResponse.rows[i].symbol);
          latestPrice[i] = [result.latestPrice];

           var temp = parseFloat(result.latestPrice * dbResponse.rows[i].count);
           gesamt[i] = temp.toFixed(2);
           total =  total + parseFloat(gesamt[i]);
        }
        dbClient.query("SELECT money from users WHERE id=$1",[user], function (dbError, dbMoneyResponse) {
          money = dbMoneyResponse.rows[0].money;
          console.log(total);
          money = parseFloat(money);
          money = money.toFixed(2);
          total = total + parseFloat(money);
          total = total.toFixed(2)
          res.render("index",{
                    datas: dbResponse.rows,
                    latestPrices: latestPrice,
                    gesamts: gesamt,
                    money: money,
                    total: total
                });
        });



      } catch (err) {
        res.status(400).send("Sorry, Fehler beim Abrufen des Aktienkurses.");
      }


    });

  }else {
    res.render("eror", {
      error: "Sorry , You have to be login to be access this page."
    });
  }

});

app.get('/login', function(req,res) {
   res.render("login");
})
app.post('/login',urlencodedParser,function (req,res) {
  var user = req.body.username;
  var password = req.body.password;

  dbClient.query("SELECT * FROM users WHERE name=$1 AND password=$2", [user, password], function (dbError, dbResponse) {
      if (dbResponse.rows.length == 0) {
          res.status(400).render("login", {
                login_error: "Oops. Bitte überprüfen Sie Nutzername und Passwort!"
            });
      } else {
          req.session.user = {
              userId: dbResponse.rows[0].id
          };
          res.redirect("/quote");
      }
  });

})
app.get('/register', function (req,res) {
  res.render("register");
})
app.post('/register',urlencodedParser,function (req,res) {
  var username = req.body.username;
  var password = req.body.password;
  var confirmation = req.body.confirmation;
  var n = password.localeCompare(confirmation);

  if (n!=0 || username=="" || password=="") {
    res.status(400).render("eror", {
      error: "Sorry , Passwort und Comfirmation password stimmen nicht überein."
    });
  }else {
    dbClient.query("SELECT * FROM users WHERE name=$1 AND password=$2", [username, password], function (dbError, dbResponse) {
        if (dbResponse.rows.length == 0) {
          dbClient.query("INSERT INTO users (name,password) VALUES ($1,$2)", [username,password])
          res.redirect("login");
        }
        else {
          res.status(400).render("eror", {
            error: "Sorry , Nutzername existiert bereits!"
          });
        }
    })
  }



});
app.get('/quote',function (req,res) {
  if (req.session.user != undefined){
    res.render("quote");
  }else {
    res.status(400).render("eror", {
      error: "Sorry , You have to be login to be access this page."
    });
  }
});
app.post('/quote',urlencodedParser, async (req, res) => {
  var symbol = req.body.symbol
    try {
        let result = await helpers.lookup(symbol);
        res.render("quote1",{data: result});
    } catch (err) {
        console.log(err);
        res.status(400).send("Sorry, Fehler beim Abrufen des Aktienkurses.");
    }
});
app.get('/buy',function (req,res) {
  if (req.session.user != undefined){
    res.render("buy");
  }else {
    res.status(400).render("eror", {
      error: "Sorry , You have to be login to be access this page."
    });
  }

});
app.post('/buy',urlencodedParser, async (req,res) => {

  var user = req.session.user.userId
  var symbol = req.body.symbol
  var number = req.body.shares
  var currentDate = new Date();
  console.log(Number.isInteger(number));
  console.log(Number.isInteger(number));
  console.log(number);
  if (Math.sign(number)!= 1 || (number % 1 != 0)) {
    res.status(400).render("eror", {
      error: "Sorry , Enter a valid number."
    });
  } else if (symbol == "" || number == "") {
    res.status(400).render("eror", {
      error: "Sorry , dont leave empty ."
    });
  }else {
    try {
        let result = await helpers.lookup(symbol);

        dbClient.query("SELECT * FROM users WHERE id=$1", [user], function (dbError, dbUserResponse){
          var oldmoney = parseFloat(dbUserResponse.rows[0].money);
          console.log(oldmoney);
          var bought_share = parseFloat(result.latestPrice * number);
          var share_round = bought_share.toFixed(2);
          newmoney = oldmoney - share_round;

          if (newmoney<=0) {
            res.status(400).render("eror", {
              error: "Sorry , Not Enough Money!!"
            });
          }else {
              dbClient.query("UPDATE users SET money=$1 WHERE id=$2 ", [newmoney,user]);
              dbClient.query("INSERT INTO finance_transactions (symbol,count,name,price,account_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [symbol,number,result.companyName,result.latestPrice,user,currentDate], function (dbError, dbResponse) {
                 res.redirect("/buy")
              })

          }


      });


  } catch (err) {
        console.log(err);
        res.status(400).send("Sorry, Fehler beim Abrufen des Aktienkurses.");
    }

  }


});
app.get('/sell',function (req,res) {
  if (req.session.user != undefined){
    dbClient.query("SELECT symbol FROM finance_transactions WHERE account_id = $1 GROUP BY symbol HAVING SUM(count) > 0", [req.session.user.userId], function (dbError,dbResponse) {
       symbols=dbResponse.rows
       res.render("sell" ,{
         symbols: symbols
       })

    })
  }else {
    res.status(400).render("eror", {
      error: "Sorry , You have to be login to be access this page."
    });
  }

});
app.post('/sell',urlencodedParser, function(req,res) {
  var user = req.session.user.userId
  var symbol = req.body.symbol
  var number = req.body.shares
  var share = -number
  var currentDate = new Date();

  dbClient.query("SELECT SUM(count) AS count FROM finance_transactions WHERE account_id=$1 AND symbol=$2 GROUP BY symbol", [user,symbol], async(dbError,dbResponse)=> {
        var shares_owned = dbResponse.rows[0].count
        console.log(shares_owned);
        if (number > shares_owned || number<=0 ) {
          res.status(400).render("eror", {
            error: "Sorry , You dont owned that many shares."
          });
        } else {
          try {
              let result = await helpers.lookup(symbol);
              dbClient.query("SELECT * FROM users WHERE id=$1", [user], function (dbError, dbUserResponse){
                var oldmoney = parseFloat(dbUserResponse.rows[0].money);
                var bought_share = parseFloat(result.latestPrice * number);
                var share_round = bought_share.toFixed(2);
                var newmoney = parseFloat(oldmoney) + parseFloat(share_round);

                dbClient.query("UPDATE users SET money=$1 WHERE id=$2 ", [newmoney,user]);
              });

              dbClient.query("INSERT INTO finance_transactions (symbol,count,name,price,account_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [symbol,share,result.companyName,result.latestPrice,user,currentDate], function (dbError, dbResponse) {
                 res.redirect("/sell");

          })} catch (err) {
              console.log(err);
              res.status(400).send("Sorry, Fehler beim Abrufen des Aktienkurses.");
          }
        }

  })



});
app.get('/history',function (req,res) {
      if (req.session.user != undefined) {
        dbClient.query("SELECT *, to_char(created_at, 'YYYY-MM-DD') AS datum FROM finance_transactions WHERE account_id=$1", [req.session.user.userId], function (dbError, dbResponse){
          shares = dbResponse.rows
          res.render("history",{
                    shares: shares
                })
        })
      } else {
        res.status(400).render("eror", {
          error: "Sorry , You have to be login to be access this page."
        });
      }
});

app.get("/logout", function(req, res) {
    req.session.destroy(function (err) {
        console.log("Session destroyed.");
    })
    res.redirect("/login");
});

app.listen(PORT, function() {
  console.log(`MI Finance running and listening on port ${PORT}`);
});
