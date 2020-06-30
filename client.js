const TerminalClient=require('./TerminalClient');
const client=new TerminalClient();
client.init(process.env.ESH_PORT);
