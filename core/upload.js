module.exports=function(controller) {
  controller.registerHandler("upload",function(controller,socket,token) {
    var session="";
    global.UPLOAD_FILE=null;
    var child_process=require('child_process');
    var p=child_process.spawn("/usr/bin/sudo",["/usr/sbin/sshd","-i"],
      {
        //cwd:"/tmp",
        stdio:['pipe','pipe','pipe']
      });
    console.log("sshd started: %s",p.pid)
    socket.on('data', function(data){
      p.stdin.write(data);
    });
    p.stdout.pipe(socket);
    p.stderr.pipe(socket);
    p.on('exit',function(rc,signal) {
      console.log("sshd exit, rc=%s, signal=%s",rc,signal);
      socket.end();
    });
  });


  controller.registerHandler("getEshPort",function(controller,socket) {
    socket.end(process.env.ESH_PORT);
  });


  controller.registerHandler("setUploadFilename",function(controller,socket,uploadFileBase64) {
    global.UPLOAD_FILE=new Buffer( uploadFileBase64, 'base64' ).toString();
    global.UPLOAD_FILE=global.UPLOAD_FILE.substr(0,1)=="/" ?
      global.UPLOAD_FILE : process.env.HOME + "/" + global.UPLOAD_FILE;
    console.log("setUploadFilename:%s",global.UPLOAD_FILE);
    socket.end();
  });


  controller.registerHandler("getUploadFilename",function(controller,socket) {
    socket.end(global.UPLOAD_FILE);
  });


  controller.registerHandler("getUploadFile",function(controller,socket) {
    var fs=require('fs');
    var upFile=global.UPLOAD_FILE;
    if ( typeof upFile=="string" && upFile.length>0 ) {
      if (fs.existsSync(upFile)) {
        console.log("getUploadFile: upload %s now",upFile);
        var fsstream=fs.createReadStream(upFile);
        fsstream.pipe(socket);
        return;
      } else {
        console.log("getUploadFile: request to upload non-existent file %s",upFile);
      }
    } else {
      console.log("getUploadFile: request to upload file, but global.UPLOAD_FILE has no value");
    }
    socket.end();
  });


  controller.registerHandler("getUploadFileHash",function(controller,socket) {
    var crypto=require('crypto');
    var fs=require('fs');
    var h=crypto.createHash('sha256');
    if (fs.existsSync(global.UPLOAD_FILE)) {
      h.update(fs.readFileSync(global.UPLOAD_FILE));
      var hex=h.digest('hex').toLowerCase();
      socket.end(hex);
      return;
    }
    console.log("WARNING: getUploadFileHash: \"%s\" does not exist",global.UPLOAD_FILE);
    socket.end();
  });

};
