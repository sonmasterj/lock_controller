const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const port = 3000
const SerialPort = require('serialport')
const ByteLength = require('@serialport/parser-byte-length')
let MESS_CU_TEMP=[0x02,0x00,0x00,0x50,0x03,0x55]
async function connectArd(path) {
    return new Promise((resolve,reject)=>{
        const sp = new SerialPort(path,{baudRate:19200},function(err){
            if(err)
            {
                console.log("Error open:",err)
                return reject(null)
            }
            return resolve(sp)
        })
    })
}
function checkSum(arr){
    let sum =0;
    for(i of arr)
    {
        sum+=i
    }
    return sum&0xff
}
function  delay(time){
    return  new Promise((resolve) => setTimeout(resolve, time))
}
(async function(){
    console.log('begin find CU port!')
    let cuPort=[]
    let ports = await SerialPort.list()
    let portAvai = ports.reduce((paths, port) => {
        paths = port.manufacturer ? [...paths, port.path] : paths
        return paths
    }, [])
    console.log('port available:',portAvai)
    let serialList={}
    for await(let port of portAvai)
    {
        try{
            const sp= await connectArd(port)
            if(sp!==null)
            {
                serialList[port]=sp
            }  
        }
        catch(err){
            console.log('error connect com:',port)
            // continue
           
        }
          
    }
    // console.log(serialList)
    for await(let [port,sp] of  Object.entries(serialList))
    {
        let mess_CU=[0x02,0x00,0x00,0x50,0x03,0x55]
        const interval=setInterval(async()=>{
            sp.write(mess_CU,(err)=>{
                if(err){
                    return console.log(err)
                }
            })
            await delay(100)
            let data= sp.read(12)
            if(data!==null && data[0]===0x02 && data[3]===0x65)
            {
                console.log("found cu hardware")
                clearInterval(interval)
                cuPort.push(port)
            }
        },500)
        setTimeout(()=>{
            clearInterval(interval)
            sp.close()
        },1900)

    }
    await delay(portAvai.length*1900+100)
    console.log("cu:",cuPort)
    let cu;
    let data=[]
    if(cuPort.length>0)
    {
        cu=new SerialPort(cuPort[0],{baudRate:19200}) 
        // let config = [0x02, 0x0A ,0x00, 0x67,0x03,0x76]
        // cu.write(config,(err)=>{
        //     if(err){
        //         console.log('error set config for all cu')
        //     }
        // })
        await delay(1000)

        let parserCU = cu.pipe(new ByteLength({length:12}))
        parserCU.on('data',async(line)=>{
            if(!line){
                return
            }
            if(line[0]!==0x02){
                await cu.close()
                await delay(1000)
                return
            }
            data=[...line]
            cu.flush()
            console.log('data from cu:',line)
        })
        cu.on('close',()=>{
            console.log("cu port close")
            setInterval(()=>{
                if(!cu.isOpen)
                {
                    console.log("reconnect cu port")
                    cu=new SerialPort(cuPort[0],{baudRate:19200})
                    parserCU = cu.pipe(new ByteLength({ length: 12 }))
                    parserCU.on('data', async(line) => {
                        
                        if(!line){
                            return
                        }
                        if(line[0]!==0x02){
                            await cu.close()
                            await delay(1000)
                            return
                        }
                        data=[...line]
                        cu.flush()
                        console.log('data from cu:',line)
                    })
                }
            
            },6000)
        })
    }
    let app = express()
    app.disable('x-powered-by')
    app.use(bodyParser.json({limit: '10mb'}))
    app.use(cors())
    app.post('/locks/open',async(req,res,next)=>{
        try{
            let {deviceId,lockId}=req.body
            if(cuPort.length===0)
            {
                return res.json({
                    code:'301',
                    message: "No CU device found!",
                }) 
            }
            let MESS_CU=[...MESS_CU_TEMP]
            if(deviceId>9)
            {
                return res.json({
                    code:'302',
                    message: "Error device ID!",
                })
            }

            //send open cmd
            let lockArr=[]
            if(lockId.length===0)
            {
                lockArr=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]
            }
            else
            {
                lockArr=[...lockId]
            }
            for await(let id of lockArr)
            {
                MESS_CU[1]=deviceId
                MESS_CU[2]=id>0?id-1:0
                MESS_CU[3]=0x51
                let mess_sum=MESS_CU.slice(0,MESS_CU.length-1)
                MESS_CU[5]=checkSum(mess_sum)
                // console.log("message send cu:",MESS_CU)
                if(!cu.isOpen)
                {
                    return res.json({
                        code:'303',
                        msg: "Error connect CU port!",
                    })
                    
                }
                cu.write(MESS_CU)
                await delay(200)
                
            }
            //send status cmd
            let resultOpen=[]
            MESS_CU[3]=0x50
            MESS_CU[2]=0
            let mess_sum=MESS_CU.slice(0,MESS_CU.length-1)
            MESS_CU[5]=checkSum(mess_sum)

            if(!cu.isOpen)
            {
                return res.json({
                    code:'303',
                    msg: "Error connect CU port!",
                })
                
            }
            cu.write(MESS_CU)
            await delay(200)
            // cu.flush()
            
            if(data.length>0 && data[0]===0x02 && data[1]===MESS_CU[1]&& data[3]===0x65 )
            {
                let result=(data[6]<<16)|(data[5]<<8)|(data[4])
                // data=[]
                for(id of lockArr)
                {
                    let statusId= (result>>(id-1))&0x01
                    if(statusId===0)
                    {
                        resultOpen.push(id)
                    }
                }
                return res.json({  
                    code:'000',
                    message:'Success!',
                    data: {
                        locks:resultOpen
                    }
                })
            }
                // data=[]
            return res.json({
                code:'304',
                message: "Wrong data from CU port!",
            })
        }
        catch(err){
            console.log('api open lock error:',err)
            next(err)
        }
        
            
    
    })
    app.post('/locks/status',async(req,res,next)=>{
        try{
            let {deviceId,lockId}=req.body
            if(cuPort.length===0)
            {
                return res.json({
                    code:'301',
                    message: "No CU device found!",
                })
            }
            let MESS_CU=[...MESS_CU_TEMP]
            //check device id
            if(deviceId>9)
            {
                return res.json({
                    code:'302',
                    message: "Error device ID!",
                })
            }
            let lockArr=[]
            if(lockId.length===0)
            {
                lockArr=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24]
            }
            else
            {
                lockArr=[...lockId]
            }

            //send status cmd
            let resultStatus=[]
            MESS_CU[3]=0x50
            MESS_CU[1]=deviceId
            MESS_CU[2]=0
            let mess_sum=MESS_CU.slice(0,MESS_CU.length-1)
            MESS_CU[5]=checkSum(mess_sum)
            if(!cu.isOpen)
            {
                return res.json({
                    code:'303',
                    msg: "Error connect CU port!",
                })
            }
            
            cu.write(MESS_CU)
            await delay(200)
            // cu.flush()
            if(data.length>0 && data[0]===0x02 && data[1]===MESS_CU[1]&& data[3]===0x65 )
            {
                let result=(data[6]<<16)|(data[5]<<8)|(data[4])

                for(id of lockArr)
                {
                    let statusId= (result>>(id-1))&0x0001
                    resultStatus.push({
                        id:id,
                        status:statusId?"Close":"Open"
                    })
                }
                return res.json({  
                    code:'000',
                    message:'Success!',
                    data: {
                        locks:resultStatus
                    }
                })
            }
            return res.json({
                code:'304',
                message: "Wrong data from CU port!",
            })
        }
        catch(err){
            console.log('api lock status error:',err)
            next(err)
        }
        
     
    })
    app.listen(port,()=>{
        console.log('app is running in port '+port)
    })
})();