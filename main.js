const child_process=require('child_process');
const util=require('util');
const pty=require('node-pty');
const fs=require('fs');

const EscreenController=require(util.format('%s/EscreenController.js',process.env.ESH_HOME));
const EscreenServer=require(util.format('%s/EscreenServer.js',process.env.ESH_HOME));
const profileDir=process.argv[2];
const port=0;
const controller=new EscreenController(profileDir);
const server=new EscreenServer(port,controller);

/*
process.stdout.on('readable',function(buf) {
  let chunk;
  // Use a loop to make sure we read all available data.
  while ((chunk = process.stdin.read()) !== null) {
    stdout+=chunk;
  }
});
*/
/*
process.stdout.on('data',function(buf) {
  //fs.appendFileSync("/tmp/b","b:"+typeof(buf)+":<"+buf+">\n");
  stdout+=typeof(buf)+"<"+buf+">\n";
  //process.stdout.write(buf.toString())
});
process.on("SIGINT",function() {
  console.log("SIGINT:stdout:"+stdout);
});
*/

/*
All readable streams start in the paused mode by default but they can be easily
switched to flowing and back to paused when needed. Sometimes, the switching
happens automatically.

When a readable stream is in the paused mode, we can use the read() method to
read from the stream on demand, however, for a readable stream in the flowing
mode, the data is continuously flowing and we have to listen to events to
consume it.

In the flowing mode, data can actually be lost if no consumers are available to
handle it. This is why, when we have a readable stream in flowing mode, we need
a data event handler. In fact, just adding a data event handler switches a
paused stream into flowing mode and removing the data event handler switches
the stream back to paused mode. Some of this is done for backward compatibility
with the older Node streams interface.
*/
//const { O_RDWR, O_NOCTTY } = fs.constants;
//var fd=fs.openSync('/dev/tty',O_RDWR+O_NOCTTY);
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');

controller.init().then(function() {
  server.start().then(function(shellServer) {
    shellServer.on('listening',function() {
      var args=[
        "-c",
        "_esh_i $ESH_STY ESH_PORT; ESH_PW_FILE=$(_esh_b ESH_PW_FILE) ESH_SCREEN_EXEC=1 screen",
      ];
      process.env.ESH_PORT=shellServer.address().port;
      var p=pty.spawn("bash",args,{
        name:'xterm-color',
        cols:process.stdout.columns,
        rows:process.stdout.rows,
        //cwd:process.env.HOME,
        //env:process.env,
      });
      p.on('data',function(buf) {
        process.stdout.write(buf);
      });
      process.stdin.on('data',function(buf) {
        p.write(buf);
      });
      p.on('exit',function(code) {
        process.exit(code);
      });
      p.on('error',function(code) {
        console.error("escreen main.js caught:"+code);
      });
      process.stdout.on('resize',function() {
        p.resize(process.stdout.columns,process.stdout.rows);
      });
    });
  });
});
