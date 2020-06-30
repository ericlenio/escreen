const http=require('http');

class TerminalClient {
  init(port) {
    var self=this;
    self.port=port;
    const reqUrl=this.getBaseUrl()+'/e-create-terminal?term='+process.env.TERM;
    const opts={
      headers: {
        'Connection':'Upgrade',
        'Upgrade':'websocket',
      },
    };
    const req=http.request(reqUrl,opts);
    req.end();
    req.on('upgrade',this.upgrade.bind(this));
  }

  getBaseUrl() {
    return 'http://127.0.0.1:'+this.port;
  }

  upgrade(res,socket) {
    process.stdin.setRawMode(true);
    process.stdout.on('resize',this.resize.bind(this));
    process.stdin.pipe(socket);
    socket.pipe(process.stdout);
    //process.stdin.on('data',function(buf) {
      //socket.write(buf);
    //});
    socket.on('close',function() {
      process.exit(0);
    });
    socket.on('error',function(e) {
      console.error("TerminalClient socket: "+e);
    });
    this.termPid=res.headers['e-term-pid'];
    this.resize();
  }

  resize() {
    const reqUrl=this.getBaseUrl()+'/e-resize-terminal?pid='+this.termPid+'&columns='+process.stdout.columns+'&rows='+process.stdout.rows;
    const req=http.request(reqUrl);
    req.end();
  }
}

module.exports=TerminalClient;
