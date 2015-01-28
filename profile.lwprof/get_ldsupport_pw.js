module.exports=function(controller) {
  controller.registerHandler("getLdsupportPw",function(controller,socket,ld_url,enc_pass) {
    var url="https://svn.lincware.com/lw/ldsupportpw";
    var pw="";
    var cp=require('child_process');
    var p=cp.spawn(
      "curl",[
        "-s",
        "-H",
        "Authorization: Basic " + global.LD_SUPPORT_BASIC_AUTH,
        "--data",
        enc_pass,
        url
      ],
      {stdio:['ignore','pipe',process.stderr]}
      );
    p.stdout.on("data",function(chunk) {
      pw+=chunk;
    });
    p.on("exit",function() {
      var p2=cp.spawn("clipit",[],{stdio:['pipe','ignore',process.stderr]});
      p2.stdin.end(pw);
      var p3=cp.spawn("xdg-open",[ld_url],{stdio:['ignore','ignore',process.stderr]});
    });
    p.stdout.pipe(socket);
  });
};
