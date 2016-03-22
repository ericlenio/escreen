module.exports=function(controller) {
  controller.registerHandler("getLwsaPw",function(controller,socket,lwsa_url,pw) {
    var cp=require('child_process');
    var lwsauser="lwsa";
    // insert username/password
    lwsa_url=lwsa_url.replace(/http:\/\/(.*)/,"http://"+lwsauser+":"+encodeURIComponent(pw)+"@$1");
    var open_prog=controller.getOsProgram("OPEN");
    var p3=cp.spawn(open_prog[0],[lwsa_url],{stdio:['ignore','ignore',null]});
    socket.end();
    },true);
};
