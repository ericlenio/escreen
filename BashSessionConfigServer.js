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
const E_PORT=process.env.ESH_PORT;
const E_HOUSEKEEPING_TIMER_INTERVAL=86400000;
const E_ONE_OFF_SCRIPTS_DIR=process.env.ESH_HOME+"/private/"+process.env.ESH_USER+"/one-off-scripts";
const ENCODING='utf8';
const EVT_STATS={};

class BashSessionConfigServer extends net.Server {
  constructor() {
    super({
      // From node docs:
      // "By default (allowHalfOpen is false) the socket will send a FIN packet
      // back and destroy its file descriptor once it has written out its
      // pending write queue. However, if allowHalfOpen is set to true, the
      // socket will not automatically end() its writable side, allowing the
      // user to write arbitrary amounts of data. The user must call end()
      // explicitly to close the connection (i.e. sending a FIN packet back)."
      //
      // need allowHalfOpen=true for this server because by design a request
      // from a client should remain open so it can receive a response.
      allowHalfOpen:true,
    });
  }

  init(ts,profileDir) {
    var self=this;
    this.ts=ts;
    return new Promise(function(resolve,reject) {
      self.profileDir=profileDir;

      self.readEscreenrc().then(function() {
        self.listen(E_PORT,'127.0.0.1',function() {
          console.log("BashSessionConfigServer is listening on port: "+E_PORT);
          // look for value first from .escreenrc, else fall back to default
          process.env.ESH_PW_FILE=global.ESH_PW_FILE ||
            util.format("%s/private/%s/passwords.gpg",process.env.ESH_HOME,process.env.ESH_USER);
          resolve();
        });
      });

      var n=0;
      self.on('connection',function(socket) {
        socket.n=n++;
        socket.once("readable",function() {
          self.handleLegacyRequest(socket);
        });
      });
      self.on('error',reject);

      self.legacyHandlers={};
      self.registerLegacyHanders();
      self.registerOtherHandlers();
      //var handlers=Object.keys(self.legacyHandlers).sort();
      //handlers.forEach(function(handlerId) {
        //console.log("handler: "+handlerId);
      //});
      setInterval(function() {
        var msg="";
        Object.keys(EVT_STATS).sort().forEach(function(evtId) {
          if (msg) {
            msg+=", ";
          }
          msg+=evtId+":"+EVT_STATS[evtId];
        });
        console.log("EVT_STATS: "+msg);
      },1000*60*60);
    });
  }

  handleLegacyRequest(socket) {
    var self=this;
    socket.on("timeout",function() {
      console.error("TIMEOUT, closing:"+this.n);
      this.destroy("handleLegacyRequest: socket timeout");
    });
    socket.setTimeout(30*60*1000);
    // add a default consumer of the readable part of the socket to make sure
    // it will close
    socket.on("data",function(buf){
    });
    socket.on("error",function(e) {
      console.error("handleLegacyRequest socket error: "+e);
    });
// fix me: write a loop to keep doing socket.read() until we capture a "\n" (EOL) character
    var chunk=socket.read();
    if (chunk==null) {
      console.warn("handleLegacyRequest: null chunk");
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
    var authToken=hdr[0];
    var evtId=hdr[1];
    EVT_STATS[evtId]=evtId in EVT_STATS
      ? EVT_STATS[evtId]+1
      : 1;
    console.log("request #"+socket.n+":"+hdr);
    if (evtId!='tat' && evtId!='registerTerminal') {
      if (!this.ts.isValidAuthToken(authToken)) {
        console.error("invalid auth token: %s (evtId: %s): "+socket.n,authToken,evtId);
        socket.write("E_BAD_AUTH_TOKEN\n");
        // to do: modify handler naming convention so that for those handlers
        // that do not stream we just immediately do socket.end(); otherwise
        // you can run into block situation in some OS's (OpenBSD seems to be
        // the main one)
        if (evtId=='fpw') {
          return socket.end();
        }
        // mirror back original payload, so it can be re-used in the retry
        // logic of _esh_b
        socket.pipe(socket);
        return;
      }
      if (this.ts.isValidOneTimeAuthToken(authToken)) {
        this.ts.deleteAuthToken(authToken);
      }
      //authToken=this.ts.generateOneTimeAuthToken();
      //socket.write(authToken+"\n");
      socket.write("E_AUTH_TOKEN_OK\n");
    }
    hdr.splice(0,2);
    hdr.unshift(socket);
    try {
      // Call the handler
      this.legacyHandlers[evtId].apply(this,hdr);
    } catch(e) {
      console.error("EXCEPTION in handler:"+e);
      socket.end();
    }
  }

  registerLegacyHanders() {
    var self=this;

    self.registerHandler("hello",function(socket) {
      socket.end("HELLO\n");
    });

    self.registerHandler("registerTerminal",function(socket,pid,tty) {
      self.ts.registerTerminal(pid,tty).then(function(authToken) {
        socket.write("E_AUTH_TOKEN_OK\n");
        socket.end(authToken+"\n");
      }).catch(function(e) {
        socket.end("E_ERR_REGISTER_TERMINAL\n");
      });
    });

    self.registerHandler("deregisterTerminal",function(socket,pid) {
      self.ts.deregisterTerminal(pid);
      socket.end("E_TERM_DEREGISTERED\n");
    });

    self.registerHandler("ESH_PW_FILE",function(socket) {
      socket.end(process.env.ESH_PW_FILE+"\n");
    });

    self.registerHandler("registerSty",function(socket,pid,sty) {
      self.ts.registerSty(pid,sty).then(function(status) {
        socket.end(status+"\n");
      }).catch(function(e) {
        socket.end("E_ERR_REGISTER_STY\n");
      });
    });

    /**
     * resolve a token/marker, which might be sensitive data (e.g. a password);
     * injectToTerminal will type the data right into the pty and _esh_y reads
     * it
     */
    /*
    self.registerHandler("m",function(socket,pid,marker,sty,windowId) {
      self.ts.injectToTerminal(pid,marker,sty,windowId).then(function(status) {
        socket.end(status+"\n");
      });
    });
    */
    self.registerHandler("m2",function(socket,pid,marker) {
      self.ts.resolveMarker(pid,marker).then(function(value) {
        socket.end(value+"\n");
      });
    });

    // get ESH_TERM_AUTH_TOKEN
    self.registerHandler("tat",function(socket,pid,sty,windowId) {
      //self.ts.injectToTerminal(pid,"tat",sty,windowId).then(function(status) {
        //socket.end(status+"\n");
      //});
      self.ts.resolveMarker(pid,"tat").then(function(value) {
        socket.write("E_ENCRYPTED_AUTH_TOKEN\n");
        socket.end(Buffer.from(value).toString('base64')+"\n");
      });
    });

    self.registerHandler("about",function(socket) {
      socket.end("escreen "+process.env.ESH_VERSION+"\n");
    });

    self.registerHandler("stats",function(socket) {
      socket.end(JSON.stringify(EVT_STATS,null,1));
    });

    /**
     * get a list of all one off scripts
     */
    self.registerHandler("ooList",function(socket) {
      fs.readdir(E_ONE_OFF_SCRIPTS_DIR,function(e,files) {
        if (e) {
          console.error("ooList: "+e);
          socket.end(""+e);
          return;
        }
        files.sort().forEach(function(f,idx) {
          socket.write(f);
          socket.write("\n");
        });
        socket.end();
      });
    });

    /**
     * get a particular one off script
     */
    self.registerHandler("ooGet",function(socket,scriptName) {
      var file=E_ONE_OFF_SCRIPTS_DIR+"/"+scriptName;
      fs.readFile(file,'utf8',function(e,data) {
        if (e) {
          data=""+e;
        }
        var hash=self.computeHash(data);
        // send the hash of the script first
        socket.write(hash+"\n");
        // now send the script, gzip'd
        var z=self.getZlib();
        z.on('error',function(e) {
          console.error("ooGet compress: "+e);
          socket.end();
        });
        z.pipe(socket);
        z.end(data);
      });
    });

    self.registerHandler("ooDir",function(socket) {
      socket.end(E_ONE_OFF_SCRIPTS_DIR);
    });

    self.registerHandler("fpw",function(socket,key) {
      var pw="";
      if (key=="cbf") {
        // optimization: return 3 passwords for core, bashrc, and -prompt
        pw=util.format("p0=%s p1=%s p2=%s",
          this.computePassword(this.getSource("core")),
          this.computePassword(this.getSource("fcnlist")),
          this.computePassword(this.getSource("-prompt"))
          );
      } else {
        pw=this.computePassword(this.getSource(key));
      }
      socket.end(pw);
    });

    // upload something to client, compressed
    self.registerHandler("zup",function(socket,key) {
      var buf=this.getSource(key);
      var z=this.getZlib();
      z.on('error',function(e) {
        console.error("zup error with key \""+key+"\":"+e);
      });
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
      z.on("end",function() {
        var cp_prog=self.getOsProgram(E_OS_PROG_ENUM.COPY);
        var p=child_process.spawn(cp_prog[0], cp_prog.slice(1), {stdio:['pipe','ignore',process.stderr]});
        p.stdin.end(xselBuf);
        p.on("error",function(e) {
          console.error("setCb: p: "+e);
          socket.end(e.toString());
        });
        p.on('exit',function(rc,signal) {
          socket.end();
          console.log(`copied ${clipboardBytes} bytes to clipboard, rc=${rc}, signal=${signal}`);
          if (rc==0 && platform=="linux" && clipboardBytes<=maxXselBuf) {
            // if small enough buffer, place into X Windows primary selection too for
            // convenience
            var p2=child_process.spawn("xsel",["-i","-p"],{stdio:['pipe',process.stdout,process.stderr]});
            p2.on("error",function(e) {
              console.error("setCb: xsel: "+e);
              socket.end(e.toString());
            });
            p2.stdin.end(xselBuf);
          }
        });
      });
      z.on("data",function(chunk) {
        clipboardBytes+=chunk.length;
        xselBuf+=new String(chunk);
        if (clipboardBytes==expectedLength) {
          z.end();
        }
      });
      z.on("error",function(e) {
        console.error("setCb: z: "+e);
        socket.end(e.toString());
      });
      socket.pipe(z);
    },true);

    // send clipboard data to client
    self.registerHandler("zGetCb",function(socket,key) {
      var paste_prog=self.getOsProgram(E_OS_PROG_ENUM.PASTE);
      var p=child_process.spawn(paste_prog[0], paste_prog.slice(1),
        {stdio:['ignore','pipe',process.stderr]});
      p.on("error", function(e) {
        socket.end(e);
      });
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
      return new Promise(function(resolve,reject) {
        var p=child_process.spawn('gpg',['-d',escreenrc],{stdio:['ignore','pipe','inherit']});
        var s='';
        p.stdout.on('data',function(buf) {
          s+=buf.toString();
        });
        p.on("error",reject);
        p.on('exit',function() {
          eval(s);
          resolve();
        });
      });
    }

    escreenrc=util.format("%s/.escreenrc",process.env.HOME);
    if (fs.existsSync(escreenrc)) {
      return new Promise(function(resolve) {
        fs.readFile(escreenrc,'utf8',function(err,data) {
          eval(data);
          resolve();
        });
      });
    }

    console.warn("Could not read $HOME/.escreenrc.gpg or $HOME/.escreenrc");
    return Promise.resolve();
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
        if (ls[j].search('^[-\\w]+$')<0) continue;
        if (list.indexOf(ls[j])>=0) continue;
        if (ls[j]=="README") continue;
        if (!this.looksLikeBashFunction(util.format("%s/%s",dir,ls[j]))) continue;
        list.push(ls[j]);
      }
    }
    list.sort();
    return list.join("\n");
  }

  /**
   * read file and see if first non-comment line looks similar to:
   * <code>my_foo_function() {</code>
   */
  looksLikeBashFunction(f) {
    var lines=fs.readFileSync(f).toString().split(/\n/);
    for (var i=0; i<lines.length; i++) {
      var line=lines[i];
      if (line.indexOf("#")!=0 && line.search(/^\s*$/)<0) {
        return line.search(/^[-\w]+\(\)\s*[\{\(]/)==0;
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
    if (typeof(global.MY_PASSWORD)=='undefined') {
      console.error("please set global.MY_PASSWORD");
    }
    var hash=this.computeHash( global.MY_PASSWORD + s );
    var n=6;
    var pw=hash.substr(hash.length-n,n);
    return pw;
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
        if (/\.js$/.test(ls[j])) {
          var f=util.format("%s/%s",dirs[i],ls[j]);
          require(f)(this);
          console.log("registered "+f);
        }
      }
    }
  }

  registerHandler(evtId,handler,forwardEvent) {
    this.legacyHandlers[evtId]=handler.bind(this);
    //this.forwardEvent[evtId]=forwardEvent;
  }

}

BashSessionConfigServer.E_BASH_SESS_CFG_SERVER_PORT=E_PORT;

module.exports=BashSessionConfigServer;
