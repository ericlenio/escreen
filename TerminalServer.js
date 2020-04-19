const crypto=require('crypto');
const fs=require('fs');
const http=require('http');
const pty=require('node-pty');
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
    if (req.url!="/e-create-terminal") {
      return socket.end();
    }
    socket.write('HTTP/1.1 101 Web Socket Protocol Handshake\r\n'+
      'Upgrade: WebSocket\r\n'+
      'Connection: Upgrade\r\n'+
      '\r\n');
    req.setTimeout(0);
    var term=this.createTerminal();
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

  createTerminal() {
    //var authToken=this.generateAuthToken();
    var args=[
      "-c",
      "source "+process.env.ESH_HOME+"/esh-init; set|grep ^ESH; _esh_i $ESH_STY ESH_PORT; ESH_PW_FILE=$(_esh_b ESH_PW_FILE) exec bash --norc --noprofile",
    ];
var eshTermSessId='fix me';
process.env.ESH_TERM_SESSION_ID=eshTermSessId;

    var term=pty.spawn("bash",args,{
      name:process.env.TERM,
      encoding:ENCODING,
      //handleFlowControl:true,
      cols:process.stdout.columns,
      rows:process.stdout.rows,
      //cwd:process.env.HOME,
      //env:process.env,
    });
    term.setEncoding(ENCODING);
    //console.log("created pty: "+term._pty+":"+term.pid)

    term.ttyBuffer="";
    term.TTY_PATTERNS={
      hello:"HELLO",
      _ra_get_ldap_pw:"xxxxxx",
      _ra_term_pid:term.pid,
      //_ra_root_ssh_priv_key:self.config.RA_REMOTE_ROOT_ALLOWED_USERS.indexOf(raUser.username)>=0
        //? self.config.RA_ROOT_SSH_KEY_BASE64
        //: 'unknown'
    };
    var MAX_BUF_LENGTH=100;
    var XTERM_INVIS="\x1b\\[8m";
    term.TTY_REGEX=new RegExp(
      XTERM_INVIS+
      // most of the time we expect the pattern to immediately follow
      // XTERM_INVIS, but this next ".*?" will handle the situation when
      // bash "set -x" is in effect
      ".*?"+
      ":"+eshTermSessId+":("+Object.keys(term.TTY_PATTERNS).join("|")+")","gs");

    //
    // little handler to snag the TTY from the just launched session
    term.on('data',function grabTty(buf) {
      if (!("buffer" in grabTty)) {
        grabTty.buffer="";
      }
      grabTty.buffer+=buf;
      var m=grabTty.buffer.match(/remoteadmin session TTY: (\S+)$/sm);
      if (m) {
        //raTerminal.raTty=m[1];
        //agent.log("registered tty: "+raTerminal.raTty);
        term.removeListener('data',grabTty);
      }
      if (grabTty.buffer.length>2000) {
        // something went wrong
        console.warn("unable to parse tty from session");
        term.removeListener('data',grabTty);
      }
    });

//var fd=fs.openSync("/tmp/l","w");
    term.on('data',function(buf) {
//fs.write(fd,buf,function() {});
      term.ttyBuffer+=buf;
      term.ttyBuffer=term.ttyBuffer.replace(term.TTY_REGEX,function(match,marker) {
        term.write(term.TTY_PATTERNS[marker]+"\r");
        return "";
      });

      if (term.ttyBuffer.length>MAX_BUF_LENGTH) {
        term.ttyBuffer=term.ttyBuffer.substr(term.ttyBuffer.length-MAX_BUF_LENGTH);
      }
    });

    term.on('error',function(code) {
      console.error("escreen main.js caught:"+code);
    });
    //process.stdout.on('resize',function() {
      //term.resize(process.stdout.columns,process.stdout.rows);
    //});
    return term;
  }

}

module.exports=TerminalServer;
