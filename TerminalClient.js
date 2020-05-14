const http=require('http');
const BASE_URL='http://127.0.0.1:2020';

class TerminalClient {
  init() {
    var self=this;
    const reqUrl=BASE_URL+'/e-create-terminal?term='+process.env.TERM;
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
    const reqUrl=BASE_URL+'/e-resize-terminal?pid='+this.termPid+'&columns='+process.stdout.columns+'&rows='+process.stdout.rows;
    const req=http.request(reqUrl);
    req.end();
  }
}

module.exports=TerminalClient;
