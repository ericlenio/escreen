#! /usr/bin/nodejs
// vim:filetype=js
//var opt = require('node-getopt');
//require('shelljs/global');
var util=require('util');
var fs=require('fs');
var path=require('path');
var zlib=require('zlib');
var net=require('net');
var crypto=require('crypto');
var ESH_TMP="/tmp/esh";

var esh = {
  handlers:[],
  eshRcFile : util.format("%s/.eshrc",process.env.HOME),
  eshCore : util.format("%s/%s.eshCore",ESH_TMP,process.env.LOGNAME),
  eshHome : path.dirname(process.argv[1]),
  getEshCore : function() {
    var dir = util.format("%s/core",this.eshHome);
    var ls = fs.readdirSync(dir);
    var s = "";
    for (var i=0; i<ls.length; i++) {
      if (ls[i].search("^_ES_")<0) continue;
      s+=fs.readFileSync(dir+"/"+ls[i]);
    }
    return s;
  },
  computeHash : function(s) {
    var h = crypto.createHash('sha1');
    h.update(s);
    return h.digest('hex').toLowerCase();
  },
  computePassword : function(s) {
    return this.computeHash( MY_PASSWORD + s ).substr(0,6);
  },
};

if (fs.existsSync(esh.eshRcFile)) {
  eval(fs.readFileSync(esh.eshRcFile).toString());
}

esh.registerHandler=function(evt_id,f) {
  esh.handlers[evt_id]=f;
};

esh.registerHandler( "BOOTSTRAP_SHELL", function(evt) {
  var s=evt.socket;
  var buf="";
  buf+="echo 'bootstrapping shell now ...'\n";
  buf+="export ESH_TMP="+ESH_TMP+"\n";
  buf+="export ESH_PORT="+esh.port+"\n";
  buf+=util.format("f=%s\n",esh.eshCore);
  buf+=util.format(
    '[ -f $f ] && c="$(openssl enc -a -d -aes256 -in $f)" && eval "$c" && _ES_core 0 %s\n',
    'fcnlist_md5'
    );
  var core=esh.getEshCore();
  zlib.gzip( buf, function(_,zipped) {
    s.end( new Buffer(zipped) );
  });
});

var server = net.createServer({allowHalfOpen:true}, function (socket) {
  console.log("Connection from " + socket.remoteAddress + " at " + new Date() );
  // Define a little object to capture this event
  var evt = {
    socket : socket,
    onData : function(data) {
      var err;
      try {
        if (evt.evt_id==undefined) {
          evt.evt_id = new String(data).trim();
          esh.handlers[evt.evt_id](evt);
        }
      } catch (err) {
        console.log( "EXCEPTION: data:" + data + "Message: " + err );
      }
    },
  };
  socket.on("data", evt.onData );
  socket.on("end", function() {
    //console.log( "END of socket" );
  });
});

server.listen(0, "localhost", null, function(e) {
  esh.port = server.address().port;
  console.log("TCP server listening on port " + esh.port + " at localhost.");
  //var bash = require('child_process').spawn("bash", [], {
    //stdio: 'inherit'
  //});
  var bash = require('child_process').spawn("bash", [
    "-c",
    'eval "$(echo BOOTSTRAP_SHELL | nc localhost ' + esh.port + ' | gzip -d -c)"; exec bash'
  ], {
    stdio: 'inherit'
  });

  bash.on('exit', function (e, code) {
    console.log("shutting down esh");
    process.exit();
  });

});
