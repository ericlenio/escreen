module.exports=function(controller) {

  var CACHE={};
  var fs=require('fs');

  controller.registerHandler("sshd",function(controller,socket) {
    var session="";
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


  controller.registerHandler("getEnv",function(controller,socket,varname) {
    socket.end(process.env[varname]);
  });


  controller.registerHandler("setUploadFilename",function(controller,socket,token,uploadFileBase64) {
    var upload_file=new Buffer( uploadFileBase64, 'base64' ).toString();
    upload_file=upload_file.substr(0,1)=="/" ?
      upload_file : process.env.HOME + "/" + upload_file;
    console.log("setUploadFilename:%s",upload_file);
    var mode=fs.existsSync(upload_file) ? fs.statSync(upload_file).mode : 0;
    CACHE[token]={filename:upload_file,mode:mode};
    socket.end();
  });


  controller.registerHandler("getUploadFilename",function(controller,socket,token) {
    socket.end(CACHE[token].filename);
  });
  

  controller.registerHandler("getUploadFileMode",function(controller,socket,token) {
    socket.end(""+CACHE[token].mode);
  });


  controller.registerHandler("dropUploadToken",function(controller,socket,token) {
    delete CACHE[token];
    socket.end();
  });


  controller.registerHandler("getUploadFile",function(controller,socket,token) {
    var upFile=CACHE[token].filename;
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
      console.log("getUploadFile: request to upload file, but CACHE has no value for token %s",token);
    }
    socket.end();
  });


  controller.registerHandler("getUploadFileHash",function(controller,socket,token) {
    var crypto=require('crypto');
    var h=crypto.createHash('md5');
    if (fs.existsSync(CACHE[token].filename)) {
      h.update(fs.readFileSync(CACHE[token].filename));
      var hex=h.digest('hex').toLowerCase();
      socket.end(hex);
      return;
    }
    console.log("WARNING: getUploadFileHash: \"%s\" does not exist",CACHE[token].filename);
    socket.end();
  });

};
