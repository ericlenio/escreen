const TerminalServer=require('./TerminalServer');
const BashSessionConfigServer=require('./BashSessionConfigServer');
const ts=new TerminalServer();
const bs=new BashSessionConfigServer();

ts.init(process.env.ESH_PORT-1);
bs.init(ts,process.env.ESH_PROFILE_DIR);

Object.keys(process.env).sort().forEach(function(key) {
  console.log(key+"="+process.env[key]);
});
