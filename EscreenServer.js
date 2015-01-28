function EscreenServer(port,controller) {
  this.port=port;
  this.controller=controller;
}
module.exports=EscreenServer;

EscreenServer.prototype.start=function() {
  var controller=this.controller;
  var server=require('net').createServer(
    {allowHalfOpen:true},
    function(socket) {
      //console.log("Connection from " + socket.remoteAddress + " at " + new Date() );
      socket.setNoDelay(true);
      // Do readable here since on slow connection we may need to push data back
      // into the buffer, especially with setCb. Once a "data" event is listened
      // for it puts the stream into flow mode, and then unshift would not work.
      socket.once("readable",function() {
        controller.handleRequest(socket)
      });
    });

  server.listen(Number(this.port),"localhost",null,function(e) {
    var port = server.address().port;
    console.log("START esh server listening on: " + port);
  });
};
