const TerminalServer=require('./TerminalServer');
const BashSessionConfigServer=require('./BashSessionConfigServer');
const ts=new TerminalServer();
const bs=new BashSessionConfigServer();

ts.init(process.env.ESH_PORT-1).then(function() {
  bs.init(ts,process.env.ESH_PROFILE_DIR).then(function() {
    Object.keys(process.env).sort().forEach(function(key) {
      console.log(key+"="+process.env[key]);
    });
  });
});
