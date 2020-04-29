const child_process=require('child_process');
const crypto=require('crypto');
const fs=require('fs');
const http=require('http');
const pty=require('node-pty');
const Url=require('url');
const BashSessionConfigServer=require("./BashSessionConfigServer");

const E_TERMINAL_SERVER_PORT=2020;
const ENCODING='utf8';

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
    switch(req.url) {
      //case '/e-create-terminal':
        //this.createTerminal(req,res);
        //break;
      default:
        //res.writeHead(200,{'Content-Type':'text/plain'});
        //res.end('okay');
    }
  }

  onUpgrade(req,socket,head) {
    var url=Url.parse(req.url,true);
    if (url.pathname!="/e-create-terminal") {
      return socket.end();
    }
    socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n'+
      'Upgrade: WebSocket\r\n'+
      'Connection: Upgrade\r\n'+
      '\r\n');
    req.setTimeout(0);
    var term=this.createTerminal(url.query.term);
    socket.on('data',function(msg) {
      term.write(msg);
    });
    socket.on('error',function(e) {
      console.error("onUpgrade socket: "+e);
    });
    term.pipe(socket);
    term.on('exit',function(code) {
      //console.log("pty exited now");
      socket.end();
    });
  }

  onError(e) {
    console.error("CAUGHT: "+e);
  }

  generateAuthToken() {
    return crypto.randomBytes(3).toString('hex');
  }

  createTerminal(term) {
    var self=this;
    var args=[
      "-c",
      "source "+process.env.ESH_HOME+"/esh-init; set|grep ^ESH; _esh_i $ESH_STY ESH_PORT; ESH_PW_FILE=$(_esh_b ESH_PW_FILE) exec bash --norc --noprofile",
    ];

    var term=pty.spawn("bash",args,{
      // note: node-pty will use "name" to set the terminal type
      name:term,
      encoding:ENCODING,
      //handleFlowControl:true,
      cols:process.stdout.columns,
      rows:process.stdout.rows,
      //cwd:process.env.HOME,
      //env:process.env,
    });
    term.setEncoding(ENCODING);
    //console.log("created pty: "+term._pty+":"+term.pid)
    term.ttyRegex=new RegExp(
      // match this ANSI sequence ...
      "\x1b\\[8m"+
      // allow for other escape codes possibly injected by gnu screen ...
      ".{0,12}"+
      // and match this string
      ":(_ra_term_pid|_ra_get_ldap_pw|hello)"
    );

    term.ttyBuffer='';
    //this.logSession(term);
    term.on('error',function(code) {
      console.error("escreen main.js caught:"+code);
    });
    term.on("data",this.resolveMarkers.bind(this,term));
    term.on('exit',function() {
      console.log("terminal exited:"+term.pid)
    });
    //process.stdout.on('resize',function() {
      //term.resize(process.stdout.columns,process.stdout.rows);
    //});
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
    term.ttyBuffer=term.ttyBuffer.replace(term.ttyRegex,function(match,marker) {
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
}

module.exports=TerminalServer;
