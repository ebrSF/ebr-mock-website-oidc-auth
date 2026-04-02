const express = require('express');
const session = require('express-session');
const passport = require('passport');
const OpenIDConnectStrategy = require('passport-openidconnect').Strategy;

const app = express();

app.use(session({ secret: 'mxns-poc-secret-b', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// UPDATED: Standard Salesforce Domain to custom community portal
//const SF_DOMAIN = 'https://ebr-customer-identity-demo.my.salesforce.com';
const SF_DOMAIN = 'https://ebr-customer-identity-demo.my.site.com/portal';

passport.use(new OpenIDConnectStrategy({
    issuer: SF_DOMAIN,
    authorizationURL: `${SF_DOMAIN}/services/oauth2/authorize`,
    tokenURL: `${SF_DOMAIN}/services/oauth2/token`,
    userInfoURL: `${SF_DOMAIN}/services/oauth2/userinfo`,
    clientID: '3MVG98Gq2O8Po4ZntJzNHOYpMgStYiuz93_weStAix2GgLLcPIfH.QGA.W07v60Ynp0Fn95u1PPPTA07jRYJO',
    clientSecret: 'C91C7F8D45F27FEEA16707ABC6F664AF9C2D7828C792E450211F245B6D3EF492',
    callbackURL: 'https://ebr-mock-website-oidc-auth-78344c12b20d.herokuapp.com/auth/sfdc/callback',
    scope: 'openid profile email id' // Critical for Custom Attributes
  },
  // THE MAGIC FIX: We must explicitly declare 7 parameters so Passport passes the tokens!
  function(issuer, profile, context, idToken, accessToken, refreshToken, done) {
    
    let userData = profile; // Fallback to basic profile just in case

    // Now idToken is explicitly handed to us by the library!
    if (idToken) {
        try {
            // Split the JWT and decode the middle payload section
            const base64Url = idToken.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            userData = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
            
            console.log("SUCCESS! Decoded ID Token payload:", JSON.stringify(userData, null, 2));
        } catch (e) {
            console.error("Error decoding token:", e);
        }
    } else {
        console.error("CRITICAL: idToken is STILL missing from the payload!");
    }

    return done(null, userData); 
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// --- UI TEMPLATE ---
const renderPage = (isAuthenticated, userData) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Site B | Analytics Portal (OIDC)</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #0056b3; --bg: #f0f4f8; --text: #2c3e50; }
        body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); margin: 0; height: 100vh; display: flex; flex-direction: column; }
        .banner { background: var(--primary); color: white; padding: 25px 40px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center;}
        .banner h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }
        .container { flex: 1; max-width: 800px; margin: 40px auto; width: 100%; }
        .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); text-align: center; border-top: 4px solid var(--primary); }
        .btn { display: inline-block; padding: 12px 24px; background: var(--primary); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; transition: all 0.2s; border: none; cursor: pointer; }
        .btn:hover { background: #004494; transform: translateY(-2px); }
        .btn-logout { background: #e74c3c; margin-top: 20px; }
        .btn-logout:hover { background: #c0392b; }
        pre { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: left; overflow-x: auto; font-size: 13px; border: 1px solid #e9ecef; margin-top: 20px; color: #34495e;}
    </style>
</head>
<body>
    <div class="banner">
        <h1>MXNS - Site B (OIDC)</h1>
        ${isAuthenticated ? `<a href="/logout" class="btn btn-logout" style="margin-top:0; padding: 8px 16px;">Logout</a>` : ''}
    </div>
    <div class="container">
        <div class="card">
            ${isAuthenticated ? `
                <h2 style="margin-top:0;">Authentication Successful</h2>
                <p>Welcome! You have been verified via OpenID Connect.</p>
                <div style="text-align: left; margin-top: 30px;">
                    <strong>OIDC UserInfo Claims:</strong>
                    <pre>${JSON.stringify(userData, null, 2)}</pre>
                </div>
            ` : `
                <h2 style="margin-top:0;">Data Analytics Portal</h2>
                <p style="color: #7f8c8d; margin-bottom: 30px;">Secure access requires MXNS identity verification.</p>
                <a href="/auth/sfdc" class="btn">Login with Salesforce (OIDC)</a>
            `}
        </div>
    </div>
</body>
</html>
`;

// Routes
app.get('/', (req, res) => {
    res.send(renderPage(req.isAuthenticated(), req.user));
});

app.get('/auth/sfdc', passport.authenticate('openidconnect'));

// 1. Handle the callback from Salesforce
app.get('/auth/sfdc/callback', function(req, res, next) {
    
    // 2. Check for the exact error code Salesforce is returning (User lacks Perm Set)
    if (req.query.error === 'OAUTH_APP_ACCESS_DENIED') {
        // Render your friendly HTML page instead of crashing
        return res.status(403).send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h2 style="color: #d9534f;">Access Denied</h2>
                    <p>You do not have the required permissions to access the Analytics Portal.</p>
                    <p>Please contact your Acme Corp administrator to request access.</p>
                    <a href="https://ebr-customer-identity-demo.my.site.com/portal/s/">Return to Portal</a>
                </body>
            </html>
        `);
    }

    // 3. If there is no error, proceed with normal authentication
    // CHANGED: Using 'openidconnect' to match your strategy initialization
    // CHANGED: Redirects point to '/' because that is where your renderPage() lives
    passport.authenticate('openidconnect', {
        successRedirect: '/', 
        failureRedirect: '/'
    })(req, res, next);
});

// OIDC Logout Route
app.get('/logout', function(req, res, next) {
  req.logout(function(err) {
    if (err) { return next(err); }
    // Redirect to standard Salesforce OIDC logout endpoint
    res.redirect(`${SF_DOMAIN}/services/auth/idp/oidc/logout`);
  });
});

app.listen(process.env.PORT || 3001, () => console.log('Site B listening on port 3001'));
