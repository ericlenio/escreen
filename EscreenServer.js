var fs=require('fs');
var HOUSEKEEPING_TIMER_INTERVAL=86400000;

function EscreenServer(port,controller) {
  this.port=port;
  this.controller=controller;
}
module.exports=EscreenServer;

EscreenServer.prototype.start=function() {
  var self=this;
  
  this.startHousekeepingTimer();

  return this.readEscreenrc().then(function() {
    var server=require('net').createServer(
      {allowHalfOpen:true},
      function(socket) {
        //console.log("Connection from " + socket.remoteAddress + " at " + new Date() );
        // "setsockopt TCP_NODELAY: Invalid argument"
        //socket.setNoDelay(true);
        // Do readable here since on slow connection we may need to push data back
        // into the buffer, especially with setCb. Once a "data" event is listened
        // for it puts the stream into flow mode, and then unshift would not work.
        socket.once("readable",function() {
          self.controller.handleRequest(socket)
        });
      });

    server.listen(Number(self.port),"localhost",null,function(e) {
      var port = server.address().port;
      console.log("START esh server listening on: " + port);
    });

    return server;
  });
};

/**
 * Read and eval the .escreenrc file. First try to read $HOME/.escreenrc.gpg
 * (encrypted version), if that doesn't exist then fall back to plain
 * $HOME/.escreenrc.
 */
EscreenServer.prototype.readEscreenrc=function() {
  var fs=require('fs');
  var util=require('util');
  var child_process=require('child_process');

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
};

/**
 * this timer does a simple read on all files in /tmp/esh so that on Macos at
 * least the files do not get deleted
 * (https://superuser.com/questions/187071/in-macos-how-often-is-tmp-deleted)
 */
EscreenServer.prototype.startHousekeepingTimer=function() {
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
  },HOUSEKEEPING_TIMER_INTERVAL);
};
