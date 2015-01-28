var util=require('util');
var clim=require('clim');
clim("",console,true);
require('date-format-lite');
clim.getTime=function() {
  var d=new Date();
  return d.format("MM/DD hh:mm:ss.SS");
};

var EscreenController=require(util.format('%s/EscreenController.js',process.env.ESH_HOME));
var EscreenServer=require(util.format('%s/EscreenServer.js',process.env.ESH_HOME));
var port=process.argv[2];
var controller=new EscreenController();
var server=new EscreenServer(port,controller);
controller.init();
server.start();
