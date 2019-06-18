module.exports=function(controller) {

  controller.registerHandler("download",function(controller,socket,expected_md5,filesize,gzipped,base64filename) {
    var fs=require('fs');
    var crypto=require('crypto');
    var h=crypto.createHash('md5');
    var tmpfile="/tmp/" + Buffer.from(base64filename,'base64').toString();
    //console.log("downloading to "+tmpfile+", expected size is "+filesize);
    var bytes=0;
    var fsstream=fs.createWriteStream(tmpfile,{mode:0644});
    var finish_up=function(e) {
      fsstream.end();
      var md5=h.digest('hex').toLowerCase();
      var msg = bytes + " received, MD5 check " +
        ( md5==expected_md5 ? "SUCCEEDED" : "FAILED"+(e ? " ("+e+")" : "")) + "\n";
      socket.end(msg);
    }
    socket.on('error',finish_up);
    if (gzipped==1) {
      var z=require('zlib').Gunzip();
      socket.pipe(z).pipe(fsstream);
      z.on('data',function(chunk) {
        bytes+=chunk.length;
        h.update(chunk,'utf8');
        //console.log("z " + chunk.length+":"+bytes);
        if (bytes==filesize) {
          finish_up();
        }
      });
      z.on('error',finish_up);
    } else {
      socket.pipe(fsstream);
      socket.on('data',function(chunk) {
        bytes+=chunk.length;
        h.update(chunk,'utf8');
        if (bytes==filesize) {
          finish_up();
        }
      });
    }
  },true);
};
