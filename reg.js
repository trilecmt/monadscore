const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { keccak256 } = require('js-sha3');

function formatProxy(input) {
    const [ip, port, username, password] = input.split(':');
    const r = `http://${username}:${password}@${ip}:${port}`;
    return r;
}

class MonadAPIClient {
    constructor() {
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://monadscore.xyz",
            "Referer": "https://monadscore.xyz/",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "cross-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        };
        
        this.loadProxies();
        this.loadRefCode();
    }
    
    toChecksumAddress(address) {
        if (!address || typeof address !== 'string' || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
            throw new Error('Địa chỉ ví không hợp lệ');
        }

        address = address.toLowerCase().slice(2);
        const hash = keccak256(address);
        const hashHex = hash.toString('hex');
        let checksumAddress = '0x';

        for (let i = 0; i < 40; i++) {
            const char = address[i];
            const hashNibble = parseInt(hashHex[i], 16);
            checksumAddress += hashNibble > 7 ? char.toUpperCase() : char;
        }

        return checksumAddress;
    }

    getChecksummedWallet(wallet) {
        if (!wallet || typeof wallet !== 'string' || !wallet.match(/^0x[0-9a-fA-F]{40}$/)) {
            this.log(`Địa chỉ ví ${wallet} không hợp lệ`, 'error');
            return null;
        }

        const checksummed = this.toChecksumAddress(wallet);
        if (wallet === checksummed) {
            return wallet;
        }

        this.log(`Địa chỉ ${wallet} không đúng checksum, tự động sửa thành ${checksummed}`, 'warning');
        return checksummed;
    }

    loadProxies() {
        try {
            const proxyFile = path.join(__dirname, 'proxy.txt');
            this.proxies = fs.readFileSync(proxyFile, 'utf8')
                .replace(/\r/g, '')
                .split('\n')
                .filter(Boolean);
                
            this.log(`Đã tải ${this.proxies.length} proxy từ file`, 'success');
        } catch (error) {
            this.log(`Không thể tải file proxy: ${error.message}`, 'error');
            this.proxies = [];
        }
    }

    loadRefCode() {
        try {
            const refFile = path.join(__dirname, 'refCode.txt');
            this.refCodes = fs.readFileSync(refFile, 'utf8')
                .replace(/\r/g, '')
                .split('\n')
                .filter(Boolean);
                
            this.log(`Đã tải ${this.refCodes.length} refCode từ file`, 'success');
        } catch (error) {
            this.log(`Không thể tải file refCode: ${error.message}`, 'error');
            this.refCodes = [];
        }
    }

    getProxyForIndex(index) {
        if (!this.proxies || this.proxies.length <= index) {
            throw new Error(`Không đủ proxy: chỉ có ${this.proxies.length} proxy, yêu cầu ít nhất ${index + 1}`);
        }

        return formatProxy(this.proxies[index]);
    }
    
    getRefCodeForIndex(index) {
        return this.refCodes[index]
    }

    getAxiosInstanceWithProxy(index) {
        const proxy = this.getProxyForIndex(index);
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            return axios.create({
                headers: { ...this.headers },
                httpsAgent: proxyAgent
            });
        } catch (error) {
            this.log(`Lỗi khi tạo proxy agent: ${error.message}`, 'error');
            throw error;
        }
    }

    log(msg, type = 'info', accountIndex = null, ip = null) {
        const timestamp = new Date().toLocaleTimeString();
        const indexPrefix = accountIndex !== null ? `[Ví ${accountIndex + 1}] ` : '';
        const ipSuffix = ip ? ` | IP: ${ip}` : '';
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] ${indexPrefix}[✓] ${msg}${ipSuffix}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] ${indexPrefix}[*] ${msg}${ipSuffix}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] ${indexPrefix}[✗] ${msg}${ipSuffix}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] ${indexPrefix}[!] ${msg}${ipSuffix}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] ${indexPrefix}[ℹ] ${msg}${ipSuffix}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString();
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    }
    
    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent
            });
            
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error khi kiểm tra IP của proxy: ${error.message}`);
        }
    }
    async getValidProxy(index) {
        let attempts = 0;
        while (attempts < 3) {
            try {
                const proxyIndex = attempts === 0 ? index : Math.floor(Math.random() * this.proxies.length);
                const proxy = this.getProxyForIndex(proxyIndex);
                const proxyIP = await this.checkProxyIP(proxy);
                this.log(`Proxy hợp lệ: ${proxyIP}`, 'success', index, proxyIP);
                return { proxy, proxyIP };
            } catch (error) {
                this.log(`Lỗi proxy (thử lần ${attempts + 1}): ${error.message}`, 'warning', index);
                attempts++;
            }
        }
        return null; // Không tìm được proxy hợp lệ
    }
    async registerUser(wallet, index, proxyIP, inviteCode = "UWUlyq12") {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return { success: false, error: "Invalid wallet address" };
        }
    
        const url = "https://mscore.onrender.com/user";
        const payload = { wallet: checksummedWallet, invite: inviteCode };
    
        let attempts = 0;
        while (attempts < 10) {
            try {
                const axiosInstance = this.getAxiosInstanceWithProxy(index);
                const response = await axiosInstance.post(url, payload);
    
                if (response.status === 201 && response.data.success) {
                    return { success: true, data: response.data.user };
                } else {
                    return { success: false, error: response.data.message || "Unknown error" };
                }
            } catch (error) {
                this.log(`Lỗi khi đăng ký (thử lần ${attempts + 1}): ${error.message}`, 'warning', index, proxyIP);
                attempts++;
                await this.countdown(2); // Đợi 2 giây trước khi retry
            }
        }
        return { success: false, error: "Đăng ký thất bại sau 3 lần thử" };
    }
    

    async processWallets(wallets, concurrencyLimit = 5) {
        const processWallet = async (wallet, index) => {
            const checksummedWallet = this.getChecksummedWallet(wallet);
            if (!checksummedWallet) {
                this.log(`Bỏ qua ví ${wallet} do định dạng không hợp lệ`, 'error', index);
                return null;
            }
    
            const proxyData = await this.getValidProxy(index);
            if (!proxyData) {
                this.log(`Không tìm được proxy hợp lệ, bỏ qua ví ${checksummedWallet}`, 'error', index);
                return null;
            }
    
            const { proxy, proxyIP } = proxyData;
            this.log(`Thử đăng ký ví ${checksummedWallet}...`, 'info', index, proxyIP);
            
            const registerResult = await this.registerUser(checksummedWallet, index, proxyIP, this.getRefCodeForIndex(index));
            
            if (registerResult.success || registerResult.error === 'Success') {
                this.log(`Đăng ký thành công ref ${this.getRefCodeForIndex(index)}!`, 'success', index, proxyIP);
            } else {
                this.log(`Đăng ký không thành công! ${registerResult.error}`, 'error', index, proxyIP);
            }
        };
    
        const walletChunks = [];
        for (let i = 0; i < wallets.length; i += concurrencyLimit) {
            walletChunks.push(wallets.slice(i, i + concurrencyLimit));
        }
    
        for (const chunk of walletChunks) {
            const promises = chunk.map((wallet, idx) => processWallet(wallet, wallets.indexOf(wallet)));
            await Promise.all(promises);
            this.log(`Đã xử lý xong một batch gồm ${chunk.length} ví`, 'success');
            await this.countdown(2);
        }
    
        this.log("Hoàn thành xử lý tất cả các ví!", 'success');
    }
    async main() {
        const walletFile = path.join(__dirname, 'wallet.txt');
        const wallets = fs.readFileSync(walletFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);
        this.log("Dân cày airdrop - Đã sợ thì đừng dùng, đã dùng thì đừng sợ...", 'info');
        await this.processWallets(wallets, 30);
        this.log("Hoàn thành xử lý tất cả các ví!", 'success');
    }
}

const client = new MonadAPIClient();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});