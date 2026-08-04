import uvicorn
from whitelist_enforcer import WhitelistEnforcer
from ai_monitor import AIMonitor
import server

if __name__ == "__main__":
    enforcer = WhitelistEnforcer()
    monitor = AIMonitor()
    
    enforcer.start()
    monitor.start()
    
    uvicorn.run(server.app, host="127.0.0.1", port=8000)
