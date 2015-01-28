var server=require('net').createServer(function(socket) {});
server.listen(0,"localhost",null,function(e) {
  var port2 = server.address().port;
  process.stdout.write(""+port2);
  process.exit();
});
