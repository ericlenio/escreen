var util=require('util');
var EscreenController=require(util.format('%s/EscreenController.js',process.env.ESH_HOME));
var EscreenServer=require(util.format('%s/EscreenServer.js',process.env.ESH_HOME));
var port=process.argv[2];
var controller=new EscreenController();
var server=new EscreenServer(port,controller);
server.start();
