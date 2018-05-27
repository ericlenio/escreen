function EscreenServer(port,controller) {
  this.port=port;
  this.controller=controller;
}
module.exports=EscreenServer;

EscreenServer.prototype.start=function() {
  var self=this;

  return this.readEscreenrc().then(function() {
    var server=require('net').createServer(
      {allowHalfOpen:true},
      function(socket) {
        //console.log("Connection from " + socket.remoteAddress + " at " + new Date() );
        socket.setNoDelay(true);
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

EscreenServer.prototype.readEscreenrc=function() {
  var fs=require('fs');
  var util=require('util');
  var escreenrc=util.format("%s/.escreenrc.gpg",process.env.HOME);
  if (fs.existsSync(escreenrc)) {
    var p=require('child_process').spawn('gpg',['-d',escreenrc],{stdio:[null,'pipe','inherit']});
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
  return Promise.resolve();
};
