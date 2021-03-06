const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { google } = require("googleapis");
const { response } = require("express");
const request = require("request");
const urlParse = require("url-parse");
const queryParse = require("query-string");
const axios = require("axios");
var cron = require("node-cron");

require("dotenv").config();
const port = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// TODO: #2 @LUXIANZE setup db connection
let db = [];

/**
 * Cron Job to update database every 30 minutes
 * - loop through db
 * - check token
 * - make request
 * - put result
 */
cron.schedule("*/30 * * * *", async () => {
  // check db size
  if (db.length > 0) {
    // loop through each patient
    for (const patient of db) {
      // extract tokens
      let tokens = patient.tokens;

      // check token validity, update if it is expired
      if (isTokenExpired(tokens.tokens)) {
        const result = await axios({
          method: "POST",
          url: "https://oauth2.googleapis.com/token",
          "Content-Type": "application/x-www-form-urlencoded",
          data: {
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            refresh_token: tokens.tokens.refresh_token,
            grant_type: "refresh_token",
          },
        });

        console.log("Updated Token :>> ", result.data);
        const patient_index = db.findIndex((item) => item.id === patientID);

        let updated_patient_token = db[patient_index];

        updated_patient_token.tokens.tokens.access_token =
          result.data.access_token;
        updated_patient_token.tokens.tokens.expiry_date =
          Date.now() + result.data.expires_in * 1000;
        updated_patient_token.tokens.tokens.scope = result.data.scope;
        updated_patient_token.tokens.tokens.token_type = result.data.token_type;

        console.log("Not-updated Database Token :>> ", tokens.tokens);

        db[patient_index] = updated_patient_token;
        tokens = db[patient_index];

        console.log("Updated Database Token :>> ", tokens.tokens);
      }

      // attempt to get health data
      try {
        const result = await axios({
          method: "POST",
          headers: {
            authorization: "Bearer " + tokens.tokens.access_token,
          },
          "Content-Type": "application/json",
          url: `https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate`,
          data: {
            aggregateBy: [
              {
                dataTypeName: "com.google.step_count.delta",
                dataSourceId:
                  "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps",
              },
              {
                dataTypeName: "com.google.calories.expended",
                dataSourceId:
                  "derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended",
              },
              {
                dataTypeName: "com.google.heart_minutes",
                dataSourceId:
                  "derived:com.google.heart_minutes:com.google.android.gms:from_steps<-estimated_steps",
              },
            ],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: Date.now() - 30 * 86400000,
            endTimeMillis: Date.now(),
          },
        });

        const sessions = await axios({
          method: "GET",
          headers: {
            authorization: "Bearer " + tokens.tokens.access_token,
          },
          "Content-Type": "application/json",
          url: `https://fitness.googleapis.com/fitness/v1/users/me/sessions`,
        });

        healthDataArray = result.data.bucket;
        allSessions = sessions.data.session;
      } catch (error) {
        console.log("error :>> ", error.response);
      }

      // aggregate the health data
      const aggregated_data = {
        non_session: healthDataArray,
        session: allSessions,
      };

      // send data to server
      // TODO:@LUXIANZE #1 replace with Osama's URL
      const res = await axios.put(
        "http://localhost:1000/patient",
        aggregated_data
      );
    }
  } else {
    console.log("No patient");
  }
});

/**
 * sign up Logic:
 * 1. user goto /starter by url provided by clinicians [DONE]
 * 2. user request: check user id and record of [access_token, refresh_token, expiry]
 *  - if not exist:
 *      - log him in and store tokens [DONE]
 *
 * cron job logic:
 * 1. loop through db
 * 2. send user data request to fit API [DONE]
 * 3. store returned data to db
 */

app.get("/", (req, res) => {
  const health = app ? true : false;
  const upTime = process.uptime();
  const cpuUsage = process.cpuUsage();

  const response_html = `<html>
    <p>Server Healthy: ${health}</p>
    <p>Up Time: ${upTime}s</p>
    <p>Cpu Usage: ${cpuUsage.system}</p>
    <p>Visit <a href="">http://localhost:5000/starter?id={validpatientid}</a> for automated health data collection</p>
  </html>`;
  return res.send(response_html);
});

app.get("/starter", async (req, res) => {
  const patientID = req.query.id;

  /**
   * If user record exists. Proceed without reuqesting authorisation again
   */
  if (db.find((item) => item.id === patientID)) {
    const user = db.find((item) => item.id === patientID);
    let tokens = user.tokens;

    let healthDataArray = [];
    let allSessions = [];

    console.log("isTokenExpired :>> ", isTokenExpired(tokens.tokens));

    if (isTokenExpired(tokens.tokens)) {
      const result = await axios({
        method: "POST",
        url: "https://oauth2.googleapis.com/token",
        "Content-Type": "application/x-www-form-urlencoded",
        data: {
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
          refresh_token: tokens.tokens.refresh_token,
          grant_type: "refresh_token",
        },
      });

      console.log("Updated Token :>> ", result.data);
      const patient_index = db.findIndex((item) => item.id === patientID);

      let updated_patient_token = db[patient_index];

      updated_patient_token.tokens.tokens.access_token =
        result.data.access_token;
      updated_patient_token.tokens.tokens.expiry_date =
        Date.now() + result.data.expires_in * 1000;
      updated_patient_token.tokens.tokens.scope = result.data.scope;
      updated_patient_token.tokens.tokens.token_type = result.data.token_type;

      console.log("Not-updated Database Token :>> ", tokens.tokens);

      db[patient_index] = updated_patient_token;
      tokens = db[patient_index];

      console.log("Updated Database Token :>> ", tokens.tokens);
    }

    try {
      const result = await axios({
        method: "POST",
        headers: {
          authorization: "Bearer " + tokens.tokens.access_token,
        },
        "Content-Type": "application/json",
        url: `https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate`,
        data: {
          aggregateBy: [
            {
              dataTypeName: "com.google.step_count.delta",
              dataSourceId:
                "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps",
            },
            {
              dataTypeName: "com.google.calories.expended",
              dataSourceId:
                "derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended",
            },
            {
              dataTypeName: "com.google.heart_minutes",
              dataSourceId:
                "derived:com.google.heart_minutes:com.google.android.gms:from_steps<-estimated_steps",
            },
          ],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: Date.now() - 30 * 86400000,
          endTimeMillis: Date.now(),
        },
      });

      const sessions = await axios({
        method: "GET",
        headers: {
          authorization: "Bearer " + tokens.tokens.access_token,
        },
        "Content-Type": "application/json",
        url: `https://fitness.googleapis.com/fitness/v1/users/me/sessions`,
      });

      healthDataArray = result.data.bucket;
      allSessions = sessions.data.session;
    } catch (error) {
      console.log("error :>> ", error.response);
    }

    const aggregated_data = {
      non_session: healthDataArray,
      session: allSessions,
    };
    return res.json(aggregated_data);
  } else {
    res.cookie("id", patientID).redirect("http://localhost:5000/auth");
  }
});

app.get("/auth", (req, res) => {
  const cookie = cookieParser(req.headers.cookie).id;

  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "http://localhost:5000/steps"
  );

  const scopes = [
    "https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.sleep.read profile email openid",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state: JSON.stringify({
      callbackUrl: req.body.callbackUrl,
      userID: req.body.userid,
    }),
  });

  request(url, (err, response, body) => {
    err && console.log("error :>> ", err);
    res.cookie("id", cookie).redirect(url);
  });
});

app.get("/steps", async (req, res) => {
  const cookie = cookieParser(req.headers.cookie).id;
  const queryURL = new urlParse(req.url);
  const code = queryParse.parse(queryURL.query).code;

  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    "http://localhost:5000/steps"
  );

  const tokens = await oauth2Client.getToken(code);

  /**
   * If user not exist, create new record
   */
  if (db.find((item) => item.id === cookie) === undefined) {
    const new_user = {
      id: cookie,
      tokens: tokens,
    };
    db.push(new_user);
  }

  return res.redirect(`http://localhost:5000/starter?id=${cookie}`);
});

app.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);

/**
 * Function to turn cookie extracted from request header into usable object
 * @example cookieParser(req.headers.cookie)
 * @param {String} cookie
 */
const cookieParser = (cookie) => {
  let parsedCookie = {};
  const pairs = cookie.split(";");
  pairs.forEach((cookie_pair) => {
    const key_val = cookie_pair.split("=");
    parsedCookie[key_val[0]] = key_val[1];
  });

  return parsedCookie;
};

/**
 * Validate the expiry date of OAuth2 token
 * @param {Object} tokens
 */
const isTokenExpired = (tokens) => {
  const now = Date.now();
  return tokens.expiry_date < now;
};
