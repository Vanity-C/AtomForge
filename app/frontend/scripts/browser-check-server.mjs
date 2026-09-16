import {createServer as createSocketServer} from 'node:net';
import {createServer} from 'vite';

/** Avoid Windows-reserved default Vite ports without changing the app config. */
export async function createCheckServer(){
  const port=await new Promise((resolve,reject)=>{
    const probe=createSocketServer();
    probe.once('error',reject);
    probe.listen(0,'127.0.0.1',()=>{
      const selected=probe.address().port;
      probe.close(error=>error?reject(error):resolve(selected));
    });
  });
  const server=await createServer({server:{host:'127.0.0.1',port,strictPort:true},logLevel:'error'});
  await server.listen();
  return server;
}
