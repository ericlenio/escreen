module.exports=function(controller) {
  controller.registerHandler("download",function(controller,socket,filesize,gzipped,base64filename) {
    var fs=require('fs');
    var tmpfile="/tmp/" + new Buffer(base64filename,'base64').toString();
    console.log("downloading to "+tmpfile+", expected size is "+filesize);
    var bytes=0;
    var fsstream=fs.createWriteStream(tmpfile,{mode:0600});
    if (gzipped==1) {
      var z=require('zlib').Gunzip();
      socket.pipe(z).pipe(fsstream);
      z.on('data',function(chunk) {
        bytes+=chunk.length;
        //console.log("z " + chunk.length+":"+bytes);
        if (bytes==filesize) {
          socket.end(bytes + " received\n");
        }
      });
    } else {
      socket.pipe(fsstream);
      socket.on('data',function(chunk) {
        bytes+=chunk.length;
        if (bytes==filesize) {
          socket.end(bytes + " received\n");
        }
      });
    }
  });
};
