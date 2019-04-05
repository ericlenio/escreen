var util=require('util');
var fs=require('fs');
var net=require('net');
var crypto=require('crypto');
var zlib=require('zlib');
var os=require('os');
var child_process=require('child_process');
var OsProgEnum = Object.freeze({
  COPY : { linux : ["clipit"], darwin : ["pbcopy"], openbsd: ["xclip","-i","-selection","clipboard"] },
  PASTE : { linux : ["clipit","-c"], darwin : ["pbpaste"], openbsd: ["xclip","-o","-selection","clipboard"] },
  OPEN : { linux : ["xdg-open"], darwin : ["open"], openbsd: ["xdg-open"] },
});


function EscreenController(profileDir) {
  this.profileDir=profileDir;
}
module.exports=EscreenController;

EscreenController.prototype.getOsProgram=function(progtype) {
  var platform=os.platform();
  if (typeof progtype == "string" ) {
    return OsProgEnum[progtype][platform];
  } else {
    return progtype[platform];
  }
};

EscreenController.prototype.init=function() {
  var self=this;
  return new Promise(function(resolve) {
    self.authToken=process.env.ESH_AT;
    self.oneTimeAuthTokens=[];
    self.handlers=[];
    self.forwardEvent={};
    //self.escreenRcFile=util.format("%s/.escreenrc",process.env.HOME);

    self.registerHandler("hello",function(controller,socket) {
      socket.end("HELLO\n");
    });

    self.registerHandler("ESH_PW_FILE",function(controller,socket) {
      socket.end(
        // look for value first from .escreenrc, else fall back to default
        global.ESH_PW_FILE ||
        util.format("%s/private/%s-passwords.gpg",process.env.ESH_HOME,process.env.ESH_USER)
      );
    });

    // forward certain handers to another escreen session
    self.registerHandler("forwardEscreen",function(controller,socket,forward_ESH_PORT,forward_ESH_AT,forward_ESH_NC_base64) {
      controller.forward_ESH_PORT=forward_ESH_PORT;
      controller.forward_ESH_AT=forward_ESH_AT;
      controller.forward_ESH_NC=new Buffer( forward_ESH_NC_base64, 'base64' ).toString();
      socket.end();
    });

    self.registerHandler("unforwardEscreen",function(controller,socket) {
      controller.forward_ESH_PORT=null;
      controller.forward_ESH_AT=null;
      socket.end();
    });

    // one time auth token - UNUSED
    self.registerHandler("otat",function(controller,socket) {
      var at=controller.generateAuthToken();
      controller.oneTimeAuthTokens.push(at);
      setTimeout(function() {
        controller.expireOneTimeAuthToken(at);
      },60000);
      socket.end(at);
    });

    self.registerHandler("fpw",function(controller,socket,key) {
      var pw="";
      if (key=="cbf") {
        // optimization: return 3 passwords for core, bashrc, and fcnlist
        // 05/17/2018: actually just for core and fcnlist, bashrc is bundled in
        // to core now
        pw=util.format("p0=%s p1=%s",
          controller.computePassword(controller.getSource("core")),
          controller.computePassword(controller.getSource("fcnlist"))
          );
      } else {
        pw=controller.computePassword(controller.getSource(key));
      }
      socket.end(pw);
    });

    // upload function to client
    self.registerHandler("zup",function(controller,socket,key) {
      var buf=controller.getSource(key);
      var z=controller.getZlib();
      z.pipe(socket);
      z.end(buf);
    });

    // receive clipboard data from client, and store inside clipboard
    self.registerHandler("setCb",function(controller,socket) {
      var z=zlib.Gunzip();
      var xselBuf="";
      var maxXselBuf=255;
      var clipboardBytes=0;
      var cp_prog=controller.getOsProgram(OsProgEnum.COPY);

      var platform=os.platform();
      var p=child_process.spawn(cp_prog[0], cp_prog.slice(1), {stdio:['pipe',null,process.stderr]});
      var clipitExit=false;
      //var pt=new (require('stream').PassThrough);
      p.on('exit',function(rc,signal) {
        clipitExit=true;
        self.log("copied %s bytes to clipboard, rc=%s, signal=%s",clipboardBytes,rc,signal);
        if (platform=="linux" && clipboardBytes<=maxXselBuf) {
          // if small enough buffer, place into X Windows primary selection too for
          // convenience
          var p2 = child_process.spawn("xsel", ["-i","-p"], {stdio:['pipe',process.stdout,process.stderr]});
          p2.stdin.end(xselBuf);
        }
      });
      socket.setTimeout(5000,function() {
        self.log("*** socket timeout, %s bytes read, force closing now",clipboardBytes);
        socket.end();
        if (!clipitExit) {
          p.kill();
        }
      });
      socket.on("end", function() {
        socket.end();
      });
      z.on("data", function(chunk) {
        clipboardBytes+=chunk.length;
        if (xselBuf.length<=maxXselBuf) xselBuf+=new String(chunk);
      });
      z.on("error", function(e) {
        self.log("zlib error in setCb: %s",e);
      });
      socket.pipe(z).pipe(p.stdin);
    },true);

    // send clipboard data to client
    self.registerHandler("zGetCb",function(controller,socket,key) {
      var paste_prog=controller.getOsProgram(OsProgEnum.PASTE);
      var p=child_process.spawn(paste_prog[0], paste_prog.slice(1),
        {stdio:['ignore','pipe',process.stderr]});
      var z=controller.getZlib();
      p.stdout.pipe(z).pipe(socket);
    },true);

    var logfile=util.format("%s/%s.log",process.env.ESH_TMP,process.env.USER);
    var stream=fs.createWriteStream(logfile);
    stream.on('open',function(fd) {
      self.log=function(msg) {
        stream.write(msg,'utf8');
        stream.write("\n",'utf8');
      };
      self.registerOtherHandlers();
      resolve();
    });
  });
}

EscreenController.prototype.expireOneTimeAuthToken=function(at) {
  var idx=this.oneTimeAuthTokens.indexOf(at);
  if (idx<0) return;
  this.oneTimeAuthTokens.splice(idx,1);
};

EscreenController.prototype.getCachedFcnlistFile=function() {
  return util.format("%s/%s.fcnlist",process.env.ESH_TMP,process.env.USER);
};

EscreenController.prototype.getFcnlist=function() {
  var list=[];
  var dirs=new Array(
    this.getProfileDir(),
    this.getCoreDir()
  );
  for (var i in dirs) {
    var dir=dirs[i];
    var ls=fs.readdirSync(dir);
    for (var j=0; j<ls.length; j++) {
      if (ls[j].search('^\\w+$')<0) continue;
      if (list.indexOf(ls[j])>=0) continue;
      if (ls[j]=="README") continue;
      if (!this.looksLikeBashFunction(util.format("%s/%s",dir,ls[j]))) continue;
      list.push(ls[j]);
    }
  }
  list.sort();
  return list.join("\n");
};

EscreenController.prototype.looksLikeBashFunction=function(f) {
  var lines=fs.readFileSync(f).toString().split(/\n/);
  for (var i=0; i<lines.length; i++) {
    var line=lines[i];
    if (line.indexOf("#")!=0 && line.search(/^\s*$/)<0) {
      return line.search(/^\w+\(\)\s*\{/)==0;
    }
  }
  return false;
};

EscreenController.prototype.getProfileDir=function() {
  return this.profileDir;
};

EscreenController.prototype.getCachedBashrcFile=function() {
  return util.format("%s/%s.bashrc",process.env.ESH_TMP,process.env.USER);
};

EscreenController.prototype.getBashrc=function() {
  var f=util.format("%s/bashrc",this.getProfileDir());
  var s="";
  if (fs.existsSync(f)) {
    s=fs.readFileSync(f);
  }
  return s;
};

EscreenController.prototype.getVimrc=function() {
  var f=util.format("%s/vimrc",this.getProfileDir());
  var s="";
  if (fs.existsSync(f)) {
    // read file and remove vimrc comments
    s=String(fs.readFileSync(f)).replace(/\r?\n\s*".*$/gm,"");
  }
  return s;
};

EscreenController.prototype.getCachedCoreFile=function() {
  return util.format("%s/%s.core",process.env.ESH_TMP,process.env.USER);
};

EscreenController.prototype.getCoreDir=function() {
  return util.format("%s/core",process.env.ESH_HOME);
};

EscreenController.prototype.computeHash=function(s) {
  var h=crypto.createHash('sha256');
  h.update(s);
  var hex=h.digest('hex').toLowerCase();
  return hex;
};


EscreenController.prototype.computePassword=function(s) {
  // MY_PASSWORD should be defined in esh.escreenRcFile
  var hash=this.computeHash( global.MY_PASSWORD + s );
  var n=6;
  var pw=hash.substr(hash.length-n,n);
  return pw;
};

EscreenController.prototype.generateAuthToken=function() {
  return crypto.randomBytes(3).toString('hex');
};

EscreenController.prototype.getZlib=function() {
  return zlib.createGzip({level:zlib.Z_BEST_COMPRESSION});
};

//
// this returns a group of core functions necessary for all bash sessions
EscreenController.prototype.getCore=function() {
  var dir=this.getCoreDir();
  var ls=fs.readdirSync(dir);
  var s="";
  for (var i=0; i<ls.length; i++) {
    if (ls[i].search("^_")<0) continue;
    s+=fs.readFileSync(dir+"/"+ls[i]);
  }
  s+=this.getBashrc();
  s+="_vimrc() {\n";
  s+="local f=$1\n";
  s+="cat << 'EOF' > $f\n";
  s+=this.getVimrc();
  s+="EOF\n";
  s+="chmod 644 $f || { echo \"ERROR: _vimrc: could not chmod on $f\" >&2; return 1; }\n";
  s+="}\n";
  return s;
};

EscreenController.prototype.getSource=function(key) {
  var buf="";
  if (key=="core") {
    buf=this.getCore();
  } else if (key=="fcnlist") {
    buf=this.getFcnlist();
  } else {
    var dirs=new Array(
      this.getProfileDir(),
      this.getCoreDir()
    );
    for (var i in dirs) {
      var f=util.format("%s/%s",dirs[i],key);
      if (fs.existsSync(f)) {
        buf=fs.readFileSync(f);
        break;
      }
    }
  }
  var buf2=
    // #16: make a header block that can be checked on remote end to ensure
    // code integrity: from man enc: "All the block ciphers normally use PKCS#5
    // padding also known as standard block padding: this allows a rudimentary
    // integrity or password check to be performed. However since the chance of
    // random data passing the test is better than 1 in 256 it isn't a very
    // good test."
    "0000000000000000\n"+String(buf).replace(/(^|\n)\s*#(?!#)[^\n]*\n/mg,"$1");
  return buf2;
};

EscreenController.prototype.registerOtherHandlers=function() {
  var dirs=new Array(
    this.getProfileDir(),
    this.getCoreDir()
  );
  for (var i in dirs) {
    var ls=fs.readdirSync(dirs[i]);
    for (var j=0; j<ls.length; j++) {
      if (ls[j].search(".js$")>=0) {
        var f=util.format("%s/%s",dirs[i],ls[j]);
        var l=require(f);
        l(this);
        this.log("registered " + f);
      }
    }
  }
};

EscreenController.prototype.registerHandler=function(evtId,handler,forwardEvent) {
  this.handlers[evtId]=handler;
  this.forwardEvent[evtId]=forwardEvent;
};

EscreenController.prototype.handleRequest=function(socket) {
  var chunk=socket.read();
  if (chunk==null) {
    this.log("WARNING: null chunk");
    return;
  }
  var hdr=[];
  for (var i=0;i<chunk.length;i++) {
    if (chunk[i]==10) {
      var xtra;
      if (i<chunk.length-1) {
        var xtra=chunk.slice(i+1);
        var res=socket.unshift(xtra);
        this.log("unshift %s bytes",xtra.length);
      }
      hdr=new String(chunk.slice(0,i)).split(" ");
      break;
    }
  }
  if (hdr.length==0) {
    hdr=new String(chunk).trim().split(" ");
  }
  if (this.oneTimeAuthTokens.indexOf(hdr[0])>=0) {
    this.expireOneTimeAuthToken(hdr[0]);
  } else if (hdr[0]!=this.authToken) {
    this.log("ERROR: unmatched auth token: %s (expected %s): %s",hdr[0],this.authToken,hdr[1]);
    setTimeout( function() { socket.end("bad auth token"); }, 3000 );
    return;
  }
  var evtId = hdr[1];
  hdr.splice(0,2);
  this.log(evtId+":"+hdr);
  hdr.unshift(this,socket);
  if (this.forwardEvent[evtId] && this.forward_ESH_AT) {
    hdr.unshift(evtId);
    try {
      this.forwardRequest.apply(null,hdr);
    } catch (err) {
      this.log("EXCEPTION in forwardRequest:"+err);
    }
  } else {
    try {
      // Call the handler
      //esh.handlers[evt.evtId](evt,hdr);
      this.handlers[evtId].apply(null,hdr);
    } catch (err) {
      this.log("EXCEPTION in handler:"+err);
    }
  }
};

// forward request from a nested escreen to its parent escreen
EscreenController.prototype.forwardRequest=function(evtId,controller,socket) {
  this.log("forwardRequest:%s",evtId);
  var sock2=net.createConnection({port:controller.forward_ESH_PORT});
  var hdr=controller.forward_ESH_AT+" "+evtId;
  for (var i=3;i<arguments.length;i++) {
    hdr+=" "+arguments[i];
  }
  this.log("forwardRequest:hdr:%s",hdr);
  sock2.on('connect', function(){
    sock2.write(hdr+"\n");
    socket.pipe(sock2);
    sock2.pipe(socket);
  });
  sock2.on('error', function(e){
    this.log("ERROR in forwardRequest: %s",e);
  });
};
