const child_process=require('child_process');
const crypto=require('crypto');
const fs=require('fs');
const http=require('http');
const pty=require('node-pty');
const Url=require('url');
const BashSessionConfigServer=require("./BashSessionConfigServer");

const E_TERMINAL_SERVER_PORT=2020;
const ENCODING='utf8';
const E_TERMINALS={};
const E_TTY_REGEX=new RegExp(
  // match this ANSI sequence ...
  "\x1b\\[8m"+
  // allow for other escape codes possibly injected by gnu screen ...
  ".{0,12}"+
  // and match this string
  ":(_ra_term_pid|_ra_get_ldap_pw|hello)"
);
const E_MIME_TYPES={
  html:"text/html",
  md:"text/plain",
};

class TerminalServer extends http.Server {

  init() {
    var self=this;
    this.listen(E_TERMINAL_SERVER_PORT,'127.0.0.1',function() {
      console.log("TerminalServer is listening on port: "+E_TERMINAL_SERVER_PORT);
    });

    this.on('request',this.satisfyRoute);
    this.on('upgrade',this.onUpgrade);
    this.on('error',this.onError);
  }

  satisfyRoute(req,res) {
    var url=Url.parse(req.url,true);
    switch(url.pathname) {
      case '/mdwiki.html':
        return this.staticFile(res,"mdwiki.html");
        break;
      case '/README.md':
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

  generateAuthToken() {
    return crypto.randomBytes(3).toString('hex');
  }

  createTerminal(termType) {
    var self=this;
    var args=[
      "-c",
      "source "+process.env.ESH_HOME+"/esh-init; _esh_i $ESH_STY ESH_PORT; ESH_PW_FILE=$(_esh_b ESH_PW_FILE) exec bash -i",
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

    term.ttyBuffer='';
    //this.logSession(term);
    term.on('error',function(code) {
      console.error("createTerminal caught:"+code);
      delete E_TERMINALS[term.pid];
    });
    E_TERMINALS[term.pid]=term;
    term.on("data",this.resolveMarkers.bind(this,term));
    term.on('exit',function() {
      console.log("terminal exited:"+term.pid)
      delete E_TERMINALS[term.pid];
    });
    return term;
  }

  logSession(term) {
    var fd=fs.openSync("/tmp/l","w");
    term.on("data",function(buf) {
      fs.write(fd,buf,function() {});
    });
  }

  resolveMarkers(term,buf) {
    var self=this;
    var MAX_BUF_LENGTH=100;
    var delim=";";
    term.ttyBuffer+=buf;
    term.ttyBuffer=term.ttyBuffer.replace(E_TTY_REGEX,function(match,marker) {
      switch(marker) {
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

  /**
   * this function acquires local user's LDAP password using the
   * <code>pw</code> shell script
   *
   * @returns {Promise} promise resolves with the base64 encoded password
   */
  _ra_get_ldap_pw() {
    return new Promise(function(resolve,reject) {
      var pwKey=global.MY_LDAP_PASSWORD_KEY;
      if (!pwKey) {
        var msg="_ra_get_ldap_pw: please set global.MY_LDAP_PASSWORD_KEY";
        reject(msg);
      }
      var args=[
        "-c",
        "source "+process.env.ESH_HOME+"/esh-init; _esh_i $ESH_STY ESH_PORT; ESH_PW_FILE=$(_esh_b ESH_PW_FILE </dev/null); pw",
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
        // strip off trailing white space, and convert to base 64
        resolve(Buffer.from(pw.replace(/\s*$/,"")).toString('base64'));
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
        return res.end(e);
      }
      res.writeHead(200,{'Content-Type':type});
      res.end(data);
    });
  }

}

module.exports=TerminalServer;
