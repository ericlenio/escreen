module.exports=function(server) {

  // Simple cache for tracking individual upload requests
  var CACHE={};
  var fs=require('fs');

  server.registerHandler("sshd",function(socket) {
    //socket.cork();
    var child_process=require('child_process');
    var p=child_process.spawn("sudo",["/usr/sbin/sshd","-i"],
      {
        //cwd:"/tmp",
        stdio:['pipe','pipe',process.stderr]
      });
    //console.log("sshd started: %s",p.pid)
    socket.pipe(p.stdin);
    //socket.on('data', function(data){
      //p.stdin.write(data);
    //});
    p.stdout.pipe(socket);
    //p.stderr.pipe(socket);
    p.on('exit',function(rc,signal) {
      //console.log("sshd exit, rc=%s, signal=%s",rc,signal);
      socket.end();
    });
  },true);


  // Get values of arbitrary environment variables: values separated by |
  server.registerHandler("getEnv",function(socket) {
    for (var i=1; i<arguments.length; i++) {
      var varname=arguments[i];
      socket.write(process.env[varname]);
      if (i<arguments.length-1) socket.write("|");
    }
    socket.end("\n");
  },true);


  server.registerHandler("setUploadFilename",function(socket,token,uploadFileBase64) {
    var upload_file=Buffer.from( uploadFileBase64, 'base64' ).toString();
    upload_file=upload_file.substr(0,1)=="/" ?
      upload_file : process.env.HOME + "/" + upload_file;
    //console.log("setUploadFilename:%s",upload_file);
    var stat=fs.existsSync(upload_file) ? fs.statSync(upload_file) : null;
    var mode=Number( (stat ? stat.mode : 0) & 07777).toString(8);
    var size=Number(stat ? stat.size : 0);
    CACHE[token]={filename:upload_file,mode:mode,size:size};
    socket.end();
  },true);


  server.registerHandler("getUploadFileInfo",function(socket,token) {
    socket.end(
      CACHE[token].filename + "|" +
      CACHE[token].mode + "|" +
      CACHE[token].size
      );
  },true);
  


  server.registerHandler("dropUploadToken",function(socket,token) {
    delete CACHE[token];
    socket.end();
  },true);


  server.registerHandler("getUploadFile",function(socket,token) {
    var upFile=CACHE[token].filename;
    if ( typeof upFile=="string" && upFile.length>0 ) {
      if (fs.existsSync(upFile)) {
        //console.log("getUploadFile: upload %s now",upFile);
        var fsstream=fs.createReadStream(upFile);
        var crypto=require('crypto');
        var h=crypto.createHash('md5');
        CACHE[token].md5hash=h;
        fsstream.on('data', function(chunk) {
          h.update(chunk,'utf8');
        });
        fsstream.pipe(socket);
        return;
      }
    } else {
      console.error("getUploadFile: request to upload file, but CACHE has no value for token %s",token);
    }
    socket.end();
  },true);


  server.registerHandler("getUploadFileHash",function(socket,token) {
    if (fs.existsSync(CACHE[token].filename)) {
      var md5=CACHE[token].md5hash.digest('hex').toLowerCase();
      socket.end(md5);
      return;
    }
    console.warn("WARNING: getUploadFileHash: \"%s\" does not exist",CACHE[token].filename);
    socket.end();
  },true);

};
