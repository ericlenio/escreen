const http=require('http');

class TerminalClient {
  init() {
    const reqUrl='http://127.0.0.1:2020/e-create-terminal?term='+process.env.TERM;
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
  }
}

module.exports=TerminalClient;
