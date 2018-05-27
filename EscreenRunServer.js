//var daemon=require('daemon');
var child_process=require('child_process');
var util=require('util');

var EscreenController=require(util.format('%s/EscreenController.js',process.env.ESH_HOME));
var EscreenServer=require(util.format('%s/EscreenServer.js',process.env.ESH_HOME));
var profileDir=process.argv[2];
var port=0;
var controller=new EscreenController(profileDir);
var server=new EscreenServer(port,controller);

controller.init().then(function() {
  server.start().then(function(shellServer) {
    shellServer.on('listening',function() {
      var args=[
        "-c",
        "_esh_i $ESH_STY ESH_PORT; screen",
      ];
      process.env.ESH_PORT=shellServer.address().port;
      var p=child_process.spawn("bash",args,{
        stdio:['inherit','inherit','inherit'],
        //env:{
          //ESH_STY:"0000",
        //},
      });
      p.on('exit',function(code) {
        console.log("FINISH:"+code+":"+new Date());
        process.exit(code);
      });
    });
  });
});

//daemon({
  //cwd:'/tmp',
  //stdout:process.stdout,
  //stderr:process.stderr,
//});
