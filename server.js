const util=require('util');

process.env.ESH_HOME=__dirname;
process.env.ESH_TMP="/tmp/esh-2.0";

//const EscreenServer=require(util.format('%s/EscreenServer.js',process.env.ESH_HOME));

const TerminalServer=require('./TerminalServer');
const BashSessionConfigServer=require('./BashSessionConfigServer');
const profileDir=process.argv[2] || process.env.ESH_HOME+"/profile.lwprof";
const ts=new TerminalServer();
const bs=new BashSessionConfigServer();

ts.init();
bs.init(profileDir);
