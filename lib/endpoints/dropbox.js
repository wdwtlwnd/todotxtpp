
var DropboxOAuth2Strategy = require('passport-dropbox-oauth2').Strategy,
  path = require('path'),
  fs = require('fs'),
  _ = require('underscore'),
  passport = require('passport'),
  DropboxJS = require('dropbox'),
  Q = require('q');

var Dropbox = function(){
  // Read in the dropbox app settings.
  if (!fs.existsSync(path.join(__dirname, '../../dropbox.json'))){
    logger.error("Can't find the 'dropbox.json' file.");
    process.exit(1);
  }

  this.$dropboxSettings = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../../dropbox.json'), { encoding : 'utf-8' }));

  if (!_.has(this.$dropboxSettings, 'key') || ! _.has(this.$dropboxSettings, 'secret')){
    logger.error("'dropbox.json' must provide a key and a secret.");
    process.exit(1);
  }
};
module.exports = Dropbox;

(function(){
  this.getRevision_p = function(path, client){
    var deferred = Q.defer();
    client.stat(path, function(err, stat){
      if (err){
        deferred.reject(err);
      }
      var rev = stat._json.revision;
      deferred.resolve(rev);
    });
    return deferred.promise;
  }

  this.writeFile_p = function(path, text, revision, client){
    return this.getRevision_p(path, client)
    .then(function(rev){
      var deferred = Q.defer();

      if (rev > revision){
        throw new Error("Someone has modified this file since you last opened it.");
      }
      client.writeFile(path, text, function(error, stat) {
        if (error) {
          deferred.reject(error);
        }
        deferred.resolve({
          revision: stat._json ? stat._json.revision : undefined, 
          versionTag: stat.versionTag
        });
      });
      return deferred.promise;
    });
  }

  this.addMiddleware = function(app){
    var self = this;

    var callbackURL = global.protocol + '://';
    callbackURL += process.env.TODOHOST || 'localhost';

    if ((global.protocol === 'https' && global.PORT != 443) || 
      (global.protocol === 'http' && global.PORT != 80)){
      // Need to specify the port
      callbackURL += ':' + global.PORT;
    }

    callbackURL += '/auth/dropbox/callback';

    passport.use(new DropboxOAuth2Strategy({
        clientID: this.$dropboxSettings.key,
        clientSecret: this.$dropboxSettings.secret,
        callbackURL: callbackURL
      },
      function(accessToken, refreshToken, profile, done) {
        return done(null, {
          id: profile.id,
          email: profile.email,
          displayName: profile.displayName,
          emails: _.map(profile.emails, function(mail){ return mail.value }),
          accessToken: accessToken
        });
      }
    ));

    app.use('/list', function(req, res, next){
      if (!req.user || !req.user.accessToken){
        return res.send(403);
      }
      if (!req.session || ! req.session.path){
        return res.send(400);
      }
      var client = new DropboxJS.Client({token: req.user.accessToken});
      if (req.method === 'GET'){
        client.readFile(req.session.path, function(error, file, data) {
          if (error) {
            return res.send(403);            
          }
          res.json({text: file, revision : data._json ? data._json.revision : undefined});
        });
        return;
      } else if (req.method==='POST'){
        if (!req.body){
          return res.send(403);          
        }
        
        self.writeFile_p(req.session.path,req.body.text, 
          req.body.revision, client)
        .then(function(revs){
          res.json(revs);
          res.send();
        })
        .fail(function(err){
          res.json({errors: [err.message]});
        })
        .done();
        return;
      }
      res.send(400);
    });

    app.use('/revision', function(req, res, next){
      if (!req.user || !req.user.accessToken){
        return res.send(403);        
      }
      if (!req.session || ! req.session.path){
        return res.send(400);
      }
      var client = new DropboxJS.Client({token: req.user.accessToken});

      self.getRevision_p(req.session.path, client)
      .then(function(rev){
        res.json(rev);
      })
      .fail(function(err){
        res.send(500);
      })
      .done();

    });
  }
}).call(Dropbox.prototype);






  