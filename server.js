const util=require('util');

//const EscreenServer=require(util.format('%s/EscreenServer.js',process.env.ESH_HOME));

const TerminalServer=require('./TerminalServer');
const BashSessionConfigServer=require('./BashSessionConfigServer');
const profileDir=process.argv[2] || process.env.ESH_HOME+"/profile.lwprof";
const ts=new TerminalServer();
const bs=new BashSessionConfigServer();

ts.init();
bs.init(ts,profileDir);

Object.keys(process.env).sort().forEach(function(key) {
    console.log(key+"="+process.env[key]);
});
