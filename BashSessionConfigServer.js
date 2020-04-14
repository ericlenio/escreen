const fs=require('fs');
const util=require('util');
const child_process=require('child_process');
const net=require('net');
const os=require('os');
const zlib=require('zlib');
const crypto=require('crypto');

const E_OS_PROG_ENUM={
  COPY:{
    linux:["clipit"],
    darwin:["pbcopy"],
    openbsd:["xclip","-i","-selection","clipboard"],
  },
  PASTE:{
    linux:["clipit","-c"],
    darwin:["pbpaste"],
    openbsd:["xclip","-o","-selection","clipboard"],
  },
  OPEN:{
    linux:["xdg-open"],
    darwin:["open"],
    openbsd:["xdg-open"],
  },
};
const E_PORT=2021;
const E_HOUSEKEEPING_TIMER_INTERVAL=86400000;
const ENCODING='utf8';

class BashSessionConfigServer extends net.Server {

  init() {
    var self=this;
    this.listen(E_PORT,'127.0.0.1',function() {
      console.log("BashSessionConfigServer is listening on port: "+E_PORT);
    });

    this.on('connection',function(req,socket,head) {
      socket.on("readable",function() {
        self.handleLegacyRequest(socket);
      });
    });
    this.on('error',this.onError);

    this.legacyHandlers=[];
    this.registerLegacyHanders();
  }

  handleLegacyRequest(socket) {
    var self=this;
    socket.on("error",function(e) {
      console.error("handleLegacyRequest: "+e);
    });
    var chunk=socket.read();
    if (chunk==null) {
      //console.warn("handleLegacyRequest: null chunk");
      return socket.end();
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
if (!'fixme' && hdr[0]!=this.authToken) {
      console.error("unmatched auth token: %s (expected %s): %s",hdr[0],this.authToken,hdr[1]);
      setTimeout( function() { socket.end("bad auth token"); }, 3000 );
      return;
    }
    var evtId=hdr[1];
    hdr.splice(0,2);
    console.log(evtId+":"+hdr);
    hdr.unshift(socket);
    try {
      // Call the handler
      this.legacyHandlers[evtId].apply(this,hdr);
    } catch(e) {
      console.error("EXCEPTION in handler:"+e);
    }
  }

  onError(e) {
    console.error("CAUGHT: "+e);
  }

  registerLegacyHanders() {
    var self=this;

    self.registerHandler("hello",function(socket) {
      socket.end("HELLO\n");
    });

    self.registerHandler("ESH_PW_FILE",function(socket) {
      socket.end(
        // look for value first from .escreenrc, else fall back to default
        global.ESH_PW_FILE ||
        util.format("%s/private/%s-passwords.gpg",process.env.ESH_HOME,process.env.ESH_USER)
      );
    });

    self.registerHandler("fpw",function(socket,key) {
      var pw="";
      if (key=="cbf") {
        // optimization: return 3 passwords for core, bashrc, and fcnlist
        // 05/17/2018: actually just for core and fcnlist, bashrc is bundled in
        // to core now
        pw=util.format("p0=%s p1=%s",
          this.computePassword(this.getSource("core")),
          this.computePassword(this.getSource("fcnlist"))
          );
      } else {
        pw=this.computePassword(this.getSource(key));
      }
      socket.end(pw);
    });

    // upload function to client
    self.registerHandler("zup",function(socket,key) {
      var buf=this.getSource(key);
      var z=this.getZlib();
      z.pipe(socket);
      z.end(buf);
    });

    // receive clipboard data from client, and store inside clipboard
    self.registerHandler("setCb",function(socket,expectedLength) {
      var z=zlib.Gunzip();
      var xselBuf="";
      var maxXselBuf=255;
      var clipboardBytes=0;

      var platform=os.platform();
      z.on("end", function() {
        var cp_prog=this.getOsProgram(E_OS_PROG_ENUM.COPY);
        var p=child_process.spawn(cp_prog[0], cp_prog.slice(1), {stdio:['pipe','ignore',process.stderr]});
        p.stdin.end(xselBuf);
        p.on("error", function(e) {
          socket.end(e);
        });
        p.on('exit',function(rc,signal) {
          socket.end();
          self.log(`copied ${clipboardBytes} bytes to clipboard, rc=${rc}, signal=${signal}`);
          if (rc==0 && platform=="linux" && clipboardBytes<=maxXselBuf) {
            // if small enough buffer, place into X Windows primary selection too for
            // convenience
            var p2 = child_process.spawn("xsel", ["-i","-p"], {stdio:['pipe',process.stdout,process.stderr]});
            p2.stdin.end(xselBuf);
          }
        });
      });
      z.on("data", function(chunk) {
        clipboardBytes+=chunk.length;
        xselBuf+=new String(chunk);
        if (clipboardBytes==expectedLength) {
          z.end();
        }
      });
      z.on("error", function(e) {
        socket.end(e);
      });
      socket.pipe(z);
    },true);

    // send clipboard data to client
    self.registerHandler("zGetCb",function(socket,key) {
      var paste_prog=self.getOsProgram(E_OS_PROG_ENUM.PASTE);
      var p=child_process.spawn(paste_prog[0], paste_prog.slice(1),
        {stdio:['ignore','pipe',process.stderr]});
      var z=this.getZlib();
      p.stdout.pipe(z).pipe(socket);
    },true);

  }

  /**
   * Read and eval the .escreenrc file. First try to read $HOME/.escreenrc.gpg
   * (encrypted version), if that doesn't exist then fall back to plain
   * $HOME/.escreenrc.
   */
  readEscreenrc() {

    var escreenrc=util.format("%s/.escreenrc.gpg",process.env.HOME);
    if (fs.existsSync(escreenrc)) {
      var p=child_process.spawn('gpg',['-d',escreenrc],{stdio:['ignore','pipe','inherit']});
      var s='';
      p.stdout.on('data',function(buf) {
        s+=buf.toString();
      });
      return new Promise(function(resolve) {
        p.on('exit',function() {
          eval(s);
          resolve();
        });
      });
    }

    escreenrc=util.format("%s/.escreenrc",process.env.HOME);
    if (fs.existsSync(escreenrc)) {
      fs.readFile(escreenrc,'utf8',function(err,data) {
        return new Promise(function(resolve) {
          eval(data);
        });
      });
    }

    throw "Could not read $HOME/.escreenrc.gpg or $HOME/.escreenrc";
  }

  /**
   * this timer does a simple read on all files in /tmp/esh so that on Macos at
   * least the files do not get deleted
   * (https://superuser.com/questions/187071/in-macos-how-often-is-tmp-deleted)
   */
  startHousekeepingTimer() {
    var self=this;
    var dir=process.env.ESH_TMP;
    setInterval(function() {
      fs.readdir(dir,function(e,files) {
        if (e) {
          console.error("housekeeping timer: "+e);
          return;
        }
        files.forEach(function(f) {
          f=dir+"/"+f;
          var stats=fs.statSync(f);
        });
      });
    },E_HOUSEKEEPING_TIMER_INTERVAL);
  }

  getOsProgram(progtype) {
    var platform=os.platform();
    if (typeof progtype == "string" ) {
      return E_OS_PROG_ENUM[progtype][platform];
    } else {
      return progtype[platform];
    }
  }

  getFcnlist() {
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
  }

  looksLikeBashFunction(f) {
    var lines=fs.readFileSync(f).toString().split(/\n/);
    for (var i=0; i<lines.length; i++) {
      var line=lines[i];
      if (line.indexOf("#")!=0 && line.search(/^\s*$/)<0) {
        return line.search(/^\w+\(\)\s*\{/)==0;
      }
    }
    return false;
  }

  getProfileDir() {
    return this.profileDir;
  }

  getCachedBashrcFile() {
    return util.format("%s/%s.bashrc",process.env.ESH_TMP,process.env.USER);
  }

  getBashrc() {
    var f=util.format("%s/bashrc",this.getProfileDir());
    var s="";
    if (fs.existsSync(f)) {
      s=fs.readFileSync(f);
    }
    return s;
  }

  getVimrc() {
    var f=util.format("%s/vimrc",this.getProfileDir());
    var s="";
    if (fs.existsSync(f)) {
      // read file and remove vimrc comments
      s=String(fs.readFileSync(f)).replace(/\r?\n\s*".*$/gm,"");
    }
    return s;
  }

  getCachedCoreFile() {
    return util.format("%s/%s.core",process.env.ESH_TMP,process.env.USER);
  }

  getCoreDir() {
    return util.format("%s/core",process.env.ESH_HOME);
  }

  computeHash(s) {
    var h=crypto.createHash('sha256');
    h.update(s);
    var hex=h.digest('hex').toLowerCase();
    return hex;
  }

  computePassword(s) {
    // MY_PASSWORD should be defined in esh.escreenRcFile
    var hash=this.computeHash( global.MY_PASSWORD + s );
    var n=6;
    var pw=hash.substr(hash.length-n,n);
    return pw;
  }

  generateAuthToken() {
    return crypto.randomBytes(3).toString('hex');
  }

  getZlib() {
    return zlib.createGzip({level:zlib.Z_BEST_COMPRESSION});
  }

  //
  // this returns a group of core functions necessary for all bash sessions
  getCore() {
    var dir=this.getCoreDir();
    var ls=fs.readdirSync(dir);
    var s="";
    for (var i=0; i<ls.length; i++) {
      if (ls[i].search("^_")<0) continue;
      s+=fs.readFileSync(dir+"/"+ls[i]);
    }
    s+=this.getBashrc();
    s+="_vimrc() {\n";
    s+="cat << 'EOF'\n";
    s+=this.getVimrc();
    s+="EOF\n";
    s+="}\n";
    return s;
  }

  getSource(key) {
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
  }

  registerOtherHandlers() {
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
  }

  registerHandler(evtId,handler,forwardEvent) {
    this.legacyHandlers[evtId]=handler.bind(this);
    //this.forwardEvent[evtId]=forwardEvent;
  }
}

module.exports=BashSessionConfigServer;
