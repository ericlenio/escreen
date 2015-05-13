var util=require('util');
var fs=require('fs');
var net=require('net');
var crypto=require('crypto');
var zlib=require('zlib');
var os=require('os');
var child_process=require('child_process');

function EscreenController(profileDir) {
  this.profileDir=profileDir;
}
module.exports=EscreenController;

EscreenController.prototype.init=function() {
  this.authToken=process.env.ESH_AT;
  this.oneTimeAuthTokens=[];
  this.handlers=[];
  this.forwardEvent={};
  this.escreenRcFile=util.format("%s/.escreenrc",process.env.HOME);

  this.registerHandler("hello",function(controller,socket) {
    socket.end("HELLO\n");
  });

  // forward certain handers to another escreen session
  this.registerHandler("forwardEscreen",function(controller,socket,forward_ESH_PORT,forward_ESH_AT,forward_ESH_NC_base64) {
    controller.forward_ESH_PORT=forward_ESH_PORT;
    controller.forward_ESH_AT=forward_ESH_AT;
    controller.forward_ESH_NC=new Buffer( forward_ESH_NC_base64, 'base64' ).toString();
    socket.end();
  });

  this.registerHandler("unforwardEscreen",function(controller,socket) {
    controller.forward_ESH_PORT=null;
    controller.forward_ESH_AT=null;
    socket.end();
  });

  // one time auth token - UNUSED
  this.registerHandler("otat",function(controller,socket) {
    var at=controller.generateAuthToken();
    controller.oneTimeAuthTokens.push(at);
    setTimeout(function() {
      controller.expireOneTimeAuthToken(at);
    },60000);
    socket.end(at);
  });

  this.registerHandler("fpw",function(controller,socket,key) {
    var pw="";
    if (key=="cbf") {
      // optimization: return 3 passwords for core, bashrc, and fcnlist
      pw=util.format("p0=%s p1=%s p2=%s",
        controller.computePassword(controller.getSource("core")),
        controller.computePassword(controller.getSource("bashrc")),
        controller.computePassword(controller.getSource("fcnlist"))
        );
    } else {
      pw=controller.computePassword(controller.getSource(key));
    }
    socket.end(pw);
  });

  // upload function to client
  this.registerHandler("zup",function(controller,socket,key) {
    var buf=controller.getSource(key);
    var z=controller.getZlib();
    z.pipe(socket);
    z.end(buf);
  });

  // receive clipboard data from client, and store inside clipboard
  this.registerHandler("setCb",function(controller,socket) {
    var z=zlib.Gunzip();
    var xselBuf="";
    var maxXselBuf=255;
    var clipboardBytes=0;
    var cp_prog=null;
    var platform=os.platform();
    switch (platform) {
      case "darwin":
        cp_prog="pbcopy";
        break;
      case "linux":
        cp_prog="clipit";
        break;
      default:
        console.log("setCb ERROR: no support for OS platform %s",os);
        return;
    }
    var p=child_process.spawn(cp_prog, [], {stdio:['pipe',process.stdout,process.stderr]});
    var clipitExit=false;
    //var pt=new (require('stream').PassThrough);
    p.on('exit',function(rc,signal) {
      clipitExit=true;
      console.log("copied %s bytes to clipboard, rc=%s, signal=%s",clipboardBytes,rc,signal);
      if (platform=="linux" && clipboardBytes<=maxXselBuf) {
        // if small enough buffer, place into X Windows primary selection too for
        // convenience
        var p2 = child_process.spawn("xsel", ["-i","-p"], {stdio:['pipe',process.stdout,process.stderr]});
        p2.stdin.end(xselBuf);
      }
    });
    socket.setTimeout(1500,function() {
      console.log("*** socket timeout, %s bytes read, force closing now",clipboardBytes);
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
    socket.pipe(z).pipe(p.stdin);
  },true);

  // send clipboard data to client
  this.registerHandler("zGetCb",function(controller,socket,key) {
    var platform=os.platform();
    switch (platform) {
      case "darwin":
        cp_prog="pbpaste";
        cp_prog_args=[];
        break;
      case "linux":
        cp_prog="clipit";
        cp_prog_args=["-c"];
        break;
      default:
        console.log("zGetCb ERROR: no support for OS platform %s",platform);
        return;
    }
    var p=child_process.spawn(cp_prog, cp_prog_args,
      {stdio:['ignore','pipe',process.stderr]});
    var z=controller.getZlib();
    p.stdout.pipe(z).pipe(socket);
  },true);

  this.registerOtherHandlers();

  if (fs.existsSync(this.escreenRcFile)) {
    eval(fs.readFileSync(this.escreenRcFile).toString());
  } else {
    console.log( "Please create " + this.escreenRcFile + ", with MY_PASSWORD value." );
    process.exit(1);
  }
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
      list.push(ls[j]);
    }
  }
  list.sort();
  return list.join("\n");
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

EscreenController.prototype.getMd5=function(somefile) {
  var h=crypto.createHash('md5');
  var hex="";
  if (fs.existsSync(somefile)) {
    h.update(fs.readFileSync(somefile));
    hex=h.digest('hex').toLowerCase();
  }
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

EscreenController.prototype.getCore=function() {
  var dir=this.getCoreDir();
  var ls=fs.readdirSync(dir);
  var s="";
  for (var i=0; i<ls.length; i++) {
    if (ls[i].search("^_")<0) continue;
    s+=fs.readFileSync(dir+"/"+ls[i]);
  }
  return s;
};

EscreenController.prototype.getSource=function(key) {
  var buf="";
  if (key=="core") {
    buf=this.getCore();
  } else if (key=="bashrc") {
    buf=this.getBashrc();
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
  var buf2=String(buf).replace(/(^|\n)\s*#(?!#)[^\n]*\n/mg,"$1");
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
        console.log("registered " + f);
      }
    }
  }
};

EscreenController.prototype.registerHandler=function(evtId,handler,forwardEvent) {
  this.handlers[evtId]=handler;
  this.forwardEvent[evtId]=forwardEvent;
};

EscreenController.prototype.handleRequest=function(socket) {
  var err;
  var chunk=socket.read();
  if (chunk==null) {
    console.log("WARNING: null chunk");
    return;
  }
  var hdr=[];
  for (var i=0;i<chunk.length;i++) {
    if (chunk[i]==10) {
      var xtra;
      if (i<chunk.length-1) {
        var xtra=chunk.slice(i+1);
        var res=socket.unshift(xtra);
        console.log("unshift %s bytes",xtra.length);
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
    console.log("ERROR: unmatched auth token");
    setTimeout( function() { socket.end("bad auth token"); }, 5000 );
    return;
  }
  var evtId = hdr[1];
  hdr.splice(0,2);
  console.log(evtId+":"+hdr);
  hdr.unshift(this,socket);
  if (this.forwardEvent[evtId] && this.forward_ESH_AT) {
    hdr.unshift(evtId);
    try {
      this.forwardRequest.apply(null,hdr);
    } catch (err) {
      console.log("EXCEPTION in forwardRequest:"+err);
    }
  } else {
    try {
      // Call the handler
      //esh.handlers[evt.evtId](evt,hdr);
      this.handlers[evtId].apply(null,hdr);
    } catch (err) {
      console.log("EXCEPTION in handler:"+err);
    }
  }
};

// forward request from a nested escreen to its parent escreen
EscreenController.prototype.forwardRequest=function(evtId,controller,socket) {
  console.log("forwardRequest: %s",evtId);
  var sock2=net.createConnection({port:controller.forward_ESH_PORT});
  var hdr=controller.forward_ESH_AT+" "+evtId;
  for (var i=3;i<arguments.length;i++) {
    hdr+=" "+arguments[i];
  }
  sock2.on('connect', function(){
    sock2.write(hdr);
    socket.pipe(sock2);
    sock2.pipe(socket);
  });
  sock2.on('error', function(e){
    console.log("ERROR in forwardRequest: %s",e);
  });
};
