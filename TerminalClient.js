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

    req.on('upgrade',(res,socket,upgradeHead) => {
      process.stdin.setRawMode(true);
      socket.pipe(process.stdout);
      process.stdin.on('data',function(buf) {
        socket.write(buf);
      });
      socket.on('close',function() {
        process.exit(0);
      });
    });

    req.on('upgrade',function(res) {
      self.termPid=res.headers['e-term-pid'];
    });

    process.stdout.on('resize',this.resize.bind(this));
  }

  resize() {
    const reqUrl=BASE_URL+'/e-resize-terminal?pid='+this.termPid+'&columns='+process.stdout.columns+'&rows='+process.stdout.rows;
    const req=http.request(reqUrl);
    req.end();
    //req.on('response',function(res) {
      //console.log("resize response:"+res.statusCode+":"+res.statusMessage)
    //});
  }
}

module.exports=TerminalClient;
