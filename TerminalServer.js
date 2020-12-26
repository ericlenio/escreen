const child_process=require('child_process');
const crypto=require('crypto');
const fs=require('fs');
const http=require('http');
const pty=require('node-pty');
const os=require('os');
const Url=require('url');
const BashSessionConfigServer=require("./BashSessionConfigServer");

const ENCODING='utf8';
const E_TERMINALS={};
const E_ONE_TIME_AUTH_TOKENS={};
const E_TERMINAL_AUTH_TOKENS={};
const E_EXPIRE_AUTH_TOKENS_INTERVAL=300000;
const E_AUTH_TOKENS_MAX_AGE=30000;
const E_HOSTNAME=os.hostname();
//const E_MDWIKI_URL="http://dynalon.github.io/mdwiki/mdwiki-latest.html"; <-- serves up a broken version of mdwiki, use 0.6.2
// using mdwiki for reviewing edits to README.md; download mdwiki and extract
// mdwiki-slim.html from it and drop into the root dir of this project
const E_MDWIKI_FILE="mdwiki-slim.html";
/*
const E_TTY_REGEX=new RegExp(
  // match this ANSI sequence ...
  "\x1b\\[8m"+
  // allow for other escape codes possibly injected by gnu screen ...
  ".{0,12}"+
  // and match this string
  ":(_ra_term_pid|_ra_get_ldap_pw|hello|log)"
);
*/
const E_MIME_TYPES={
  html:"text/html",
  md:"text/plain",
};

class TerminalServer extends http.Server {

  init(port) {
    var self=this;
    this.listen(port,'127.0.0.1',function() {
      console.log("TerminalServer is listening on port: "+port);
    });

    this.on('request',this.satisfyRoute);
    this.on('upgrade',this.onUpgrade);
    this.on('error',this.onError);
    setInterval(this.expireAuthTokens.bind(this),E_EXPIRE_AUTH_TOKENS_INTERVAL);
  }

  satisfyRoute(req,res) {
    var url=Url.parse(req.url,true);
    switch(url.pathname) {
      case '/':
        return this.staticFile(res,E_MDWIKI_FILE);
        break;
      case '/index.md':
        return this.staticFile(res,"README.md");
        break;
      case '/e-resize-terminal':
        this.resizeTerminal(url.query.pid,url.query.columns,url.query.rows);
        res.end();
        break;
      default:
        res.writeHead(200,{'Content-Type':'text/plain'});
        res.end('OK');
    }
  }

  deleteAuthToken(authToken) {
    delete E_ONE_TIME_AUTH_TOKENS[authToken];
  }

  expireAuthTokens() {
    var now=Date.now();
    var deleted=0;
    for (const [authToken,authTokenObj] of Object.entries(E_ONE_TIME_AUTH_TOKENS)) {
      if (now-authTokenObj.createTimestamp>E_AUTH_TOKENS_MAX_AGE) {
        this.deleteAuthToken(authToken);
        deleted++;
      }
    }
    if (deleted>0) {
      console.log("expireAuthTokens: expired "+deleted+" token(s)");
    }
    console.log("expireAuthTokens: "+Object.keys(E_ONE_TIME_AUTH_TOKENS).length+" active tokens now");
  }

  onUpgrade(req,socket,head) {
    var url=Url.parse(req.url,true);
    if (url.pathname!="/e-create-terminal") {
      return socket.end();
    }
    var term=this.createTerminal(url.query.term);
    socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n'+
      'Upgrade: WebSocket\r\n'+
      'Connection: Upgrade\r\n'+
      'E-Term-Pid: '+term.pid+'\r\n'+
      '\r\n');
    req.setTimeout(0);
    socket.on('error',function(e) {
      console.error("e-create-terminal socket: "+e);
    });
    socket.pipe(term);
    term.pipe(socket);
    term.on('exit',function(code) {
      //console.log("pty exited now");
      socket.end();
    });
  }

  resizeTerminal(pid,columns,rows) {
    if (pid in E_TERMINALS) {
      E_TERMINALS[pid].resize(parseInt(columns),parseInt(rows));
      console.log("resize "+pid+":"+columns+":"+rows);
    } else {
      console.error("resizeTerminal: bad pid: "+pid);
    }
  }

  onError(e) {
    console.error("CAUGHT: "+e);
  }

  createTerminal(termType) {
    var self=this;
    var termAuthToken=this.generateTerminalAuthToken();
    var args=[
      "-c",
      "source "+process.env.ESH_HOME+"/esh-init",
      "--",
      termAuthToken, // not ideal putting this on the command line
    ];

    var term=pty.spawn("bash",args,{
      // note: node-pty will use "name" to set the terminal type
      name:termType,
      encoding:ENCODING,
      //handleFlowControl:true,
      cols:process.stdout.columns,
      rows:process.stdout.rows,
      //cwd:process.env.HOME,
      //env:process.env,
    });
    term.setEncoding(ENCODING);
    console.log("created pty: "+term._pty+":"+term.pid+":"+termType)
    E_TERMINAL_AUTH_TOKENS[termAuthToken].pid=term.pid;

    term.ttyBuffer='';
    term.isLogging=false;
    // probably should scope this log file name with something unique like term.pid ...
    term.logFile="/tmp/term.log";
    term.on('error',function(code) {
      console.error("createTerminal caught:"+code);
    });
    E_TERMINALS[term.pid]=term;
    //term.on("data",this.resolveMarkers.bind(this,term));
    term.on('exit',function() {
      console.log("terminal exited:"+term.pid)
      delete E_TERMINALS[term.pid];
      delete E_TERMINAL_AUTH_TOKENS[termAuthToken];
    });
    return term;
  }

  toggleLogging(term) {
    var status='on';
    term.isLogging=!term.isLogging;
    if (term.isLogging) {
      var fd=fs.openSync(term.logFile,"w");
      term.termLogger=function(fd,buf,stop) {
        if (stop) {
	  return fs.closeSync(fd);
        }
	fs.write(fd,buf,function() {});
      }.bind(this,fd);
      term.on('data',term.termLogger);
    } else {
      term.termLogger(null,true);
      term.removeListener('data',term.termLogger);
      status='off';
    }
    return status;
  }

  /*
  resolveMarkers(term,buf) {
    var self=this;
    var MAX_BUF_LENGTH=100;
    var delim=";";
    term.ttyBuffer+=buf;
    term.ttyBuffer=term.ttyBuffer.replace(E_TTY_REGEX,function(match,marker) {
      switch(marker) {
        case "log":
          var status=self.toggleLogging(term);
          term.write("logging is "+status.toUpperCase()+": "+term.logFile+delim);
          break;
        case "hello":
          term.write("HELLO"+delim);
          break;
        case "_ra_term_pid":
          term.write(term.pid+delim);
          break;
        case "_ra_get_ldap_pw":
          self._ra_get_ldap_pw().then(function(pw64) {
            term.write(pw64+delim);
          }).catch(function(e) {
            console.error("_ra_get_ldap_pw: "+e);
            term.write(Buffer.from("_ra_get_ldap_pw: password not available").toString("base64")+delim);
          });
          break;
      }
      return "";
    });
    if (term.ttyBuffer.length>MAX_BUF_LENGTH) {
      term.ttyBuffer=term.ttyBuffer.substr(term.ttyBuffer.length-MAX_BUF_LENGTH);
    }
  }
  */

  /**
   * resolve a marker for a piece of (possibly sensitive) data; the data is
   * injected right into the pty
   */
  resolveMarker(pid,marker) {
    var self=this;
    if (!(pid in E_TERMINALS)) {
      return Promise.resolve("E_BAD_PID");
    }
    var term=E_TERMINALS[pid];
    return new Promise(function(resolve,reject) {
      switch(marker) {
        case "log":
          var status=self.toggleLogging(term);
          resolve("logging is "+status.toUpperCase()+": "+E_HOSTNAME+":"+term.logFile);
          break;
        case "tat":
          // get terminal auth token
          for (const [authToken,authTokenObj] of Object.entries(E_TERMINAL_AUTH_TOKENS)) {
            if (authTokenObj.pid==pid) {
              return resolve(authToken);
            }
          }
          resolve("no_term_auth_token");
          break;
        case "hello":
          resolve("HELLO");
          break;
        case "_ra_term_pid":
          resolve(""+term.pid);
          break;
        case "_ra_get_ldap_pw":
          self._ra_get_ldap_pw().then(resolve)
            .catch(function(e) {
              reject("_ra_get_ldap_pw: password not available: "+e);
            });
          break;
        default:
          resolve('?');
      }
    });
  }

  injectToTerminal(pid,marker,sty,windowId) {
    if (!(pid in E_TERMINALS)) {
      return Promise.resolve("E_BAD_PID");
    }
    var term=E_TERMINALS[pid];
    var delim=';';
    var injectValue;
    return this.resolveMarker(pid,marker).then(function(value) {
      injectValue=value;
      return "E_OK";
    }).catch(function(e) {
      injectValue=e.toString();
      return "E_MARKER_ERR";
    }).finally(function() {
      // write out the value in the format "N:value" (and then base64 encoded),
      // where N is the length of value; that way the client do a small error
      // check to confirm the right value is received
      var stuffValue=Buffer.from(injectValue.length+":"+injectValue).toString("base64")+delim;
      if (sty) {
        // GNU screen is running, use the "stuff" command to write to the terminal
        var args=[
          "-X",
          "-S",
          sty,
          "-p",
          windowId,
          "stuff",
          stuffValue,
        ];
        var c=child_process.spawn('screen',args,{stdio:['ignore','pipe',process.stderr]});
        c.on("error",function(e) {
          console.error("injectToTerminal: "+e);
        });
      } else {
        // no GNU screen running, just write directly to the terminal
        term.write(stuffValue);
      }
    });
  }

  registerSty(pid,sty) {
    if (!(pid in E_TERMINALS)) {
      return "E_BAD_PID";
    }
    var term=E_TERMINALS[pid];
    term.sty=sty;
    console.log(`registerSty: STY=${sty} now registered to terminal: ${pid}`);
    return "E_OK";
  }

  generateOneTimeAuthToken() {
    var otp=this.generateAuthToken(true);
    console.log("generateOneTimeAuthToken: "+Object.keys(E_ONE_TIME_AUTH_TOKENS).length+" active tokens");
    return otp;
  }

  generateTerminalAuthToken() {
    var authToken=this.generateAuthToken(false);
    console.log("generateTerminalAuthToken: "+Object.keys(E_TERMINAL_AUTH_TOKENS).length+" active tokens");
    return authToken;
  }

  /**
   * generate an auth token - there are 2 types: one time, and terminal; one
   * time tokens always begin with the letter "o", and terminal tokens begin
   * with the letter "t"; terminal tokens are reusable for the lifetime of a
   * terminal session
   */
  generateAuthToken(isOneTime) {
    var authToken=(isOneTime ? 'o' : 't')+crypto.randomBytes(6).toString('hex');
    if (authToken in E_ONE_TIME_AUTH_TOKENS || authToken in E_TERMINAL_AUTH_TOKENS) {
      return this.generateAuthToken(isOneTime);
    }
    this.registerAuthToken(authToken,isOneTime);
    return authToken;
  }

  registerAuthToken(authToken,isOneTime) {
    if (isOneTime) {
      E_ONE_TIME_AUTH_TOKENS[authToken]={createTimestamp:Date.now()};
    } else {
      E_TERMINAL_AUTH_TOKENS[authToken]={
        pid:undefined, // set later
        createTimestamp:Date.now(),
      };
    }
  }

  isValidAuthToken(authToken) {
    return authToken in E_ONE_TIME_AUTH_TOKENS || authToken in E_TERMINAL_AUTH_TOKENS;
  }

  isValidOneTimeAuthToken(authToken) {
    return authToken in E_ONE_TIME_AUTH_TOKENS;
  }

  /**
   * this function acquires local user's LDAP password using the
   * <code>pw</code> shell script
   *
   * @returns {Promise} promise resolves with the base64 encoded password
   */
  _ra_get_ldap_pw() {
    var self=this;
    return new Promise(function(resolve,reject) {
      var pwKey=global.MY_LDAP_PASSWORD_KEY;
      if (!pwKey) {
        var msg="_ra_get_ldap_pw: please set global.MY_LDAP_PASSWORD_KEY";
        reject(msg);
      }
      var authToken=self.generateOneTimeAuthToken();
      var args=[
        "-c",
        "source "+process.env.ESH_HOME+"/esh-init; ESH_AT="+authToken+"; _esh_i $ESH_STY ESH_PORT; pw",
      ];
      var c=child_process.spawn('bash',args,{stdio:['pipe','pipe',process.stderr]});
      var pw='';
      c.on("error",function(e) {
        console.error("_ra_get_ldap_pw: spawn: "+e);
        pw='unknown';
      });
      c.stdout.on("data",function(buf) {
        pw+=buf;
      });
      c.on("exit",function(code,signal) {
        var pw64=Buffer.from(pw.replace(/\s*$/,"")).toString('base64');
        resolve(pw64);
      });
      c.stdin.end(pwKey);
    });
  }

  /**
   * serve up a static file
   */
  staticFile(res,path) {
    var fileExt=path.replace(/.*?\.(\w+)$/,"$1");
    var type=E_MIME_TYPES[fileExt];
    fs.readFile(path,{encoding:ENCODING},function(e,data) {
      if (e) {
        res.writeHead(500,{'Content-Type':'text/plain'});
        console.error("staticFile: "+e);
        return res.end();
      }
      res.writeHead(200,{'Content-Type':type});
      res.end(data);
    });
  }

}

module.exports=TerminalServer;
