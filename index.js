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

    getProxyForIndex(index) {
        if (!this.proxies || this.proxies.length <= index) {
            throw new Error(`Không đủ proxy: chỉ có ${this.proxies.length} proxy, yêu cầu ít nhất ${index + 1}`);
        }

        return formatProxy(this.proxies[index]);
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
    
    async authenticateUser(wallet, index, proxyIP) {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return { success: false, error: "Invalid wallet address" };
        }

        const url = "https://mscore.onrender.com/user";
        const payload = { wallet: checksummedWallet, invite: "" };
    
        try {
            const axiosInstance = this.getAxiosInstanceWithProxy(index);
            const response = await axiosInstance.post(url, payload);
            
            if (response.status === 200 && response.data.success) {
                const token = response.data.token;
                this.headers["Authorization"] = `Bearer ${token}`;
                this.log(`Đã lấy được token cho ví ${checksummedWallet}`, 'success', index, proxyIP);
                return { 
                    success: true, 
                    token: token,
                    refreshToken: response.data.refreshToken
                };
            } else {
                return { 
                    success: false, 
                    error: response.data.message || "Unknown error" 
                };
            }
        } catch (error) {
            return { 
                success: false, 
                error: error.response ? error.response.data.message : error.message 
            };
        }
    }

    async getUserInfo(wallet, index, proxyIP, inviteCode = "UWUlyq12") {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return { success: false, error: "Invalid wallet address" };
        }

        const url = "https://mscore.onrender.com/user/login";
        const payload = { wallet: checksummedWallet, invite: "UWUlyq12" };
        const maxRetries = 3;
        let attempts = 0;

        while (attempts < maxRetries) {
            try {
                const axiosInstance = this.getAxiosInstanceWithProxy(index);
                const response = await axiosInstance.post(url, payload);
                
                if (response.status === 200 && response.data.success) {
                    return { 
                        success: true, 
                        data: response.data.user 
                    };
                } else {
                    const errorMsg = response.data.message || "Unknown error";
                    if (errorMsg === "User retrieved successfully" && attempts < maxRetries - 1) {
                        attempts++;
                        this.log(`Thử lại lần ${attempts} do lỗi`, 'warning', index, proxyIP);
                        await this.countdown(2);
                        continue;
                    }
                    return { 
                        success: false, 
                        error: errorMsg 
                    };
                }
            } catch (error) {
                const errorMsg = error.response ? error.response.data.message : error.message;
                if (errorMsg === "User retrieved successfully" && attempts < maxRetries - 1) {
                    attempts++;
                    this.log(`Thử lại lần ${attempts} do lỗi`, 'warning', index, proxyIP);
                    await this.countdown(2);
                    continue;
                }
                return {
                    success: false,
                    error: errorMsg
                };
            }
        }

        return {
            success: false,
            error: `Đã thử ${maxRetries} lần nhưng vẫn thất bại: User retrieved successfully`
        };
    }

    async claimTask(wallet, taskId, index, proxyIP) {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return { success: false, error: "Invalid wallet address" };
        }

        const url = "https://mscore.onrender.com/user/claim-task";
        const payload = { wallet: checksummedWallet, taskId: taskId };

        try {
            const axiosInstance = this.getAxiosInstanceWithProxy(index);
            const response = await axiosInstance.post(url, payload);
            
            if (response.status === 200) {
                let message;
                switch(taskId) {
                    case "task001":
                        message = "Làm nhiệm vụ Follow MonadScore on X thành công";
                        break;
                    case "task002":
                        message = "Làm nhiệm vụ Like this post thành công";
                        break;
                    case "task003":
                        message = "Làm nhiệm vụ Retweet this post thành công";
                        break;
                    default:
                        message = `Claim task ${taskId} thành công`;
                }
                this.log(message, 'success', index, proxyIP);
                return { success: true };
            } else {
                return { success: false, error: response.data.message || "Unknown error" };
            }
        } catch (error) {
            return {
                success: false,
                error: error.response ? error.response.data.message : error.message
            };
        }
    }

    async handleTasks(wallet, claimedTasks, index, proxyIP) {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return;
        }

        const requiredTasks = ["task001", "task002", "task003"];
        const missingTasks = requiredTasks.filter(task => !claimedTasks.includes(task));

        if (missingTasks.length === 0) {
            this.log("Đã hoàn thành tất cả các nhiệm vụ yêu cầu", 'success', index, proxyIP);
            return;
        }

        this.log(`Cần thực hiện ${missingTasks.length} nhiệm vụ: ${missingTasks.join(', ')}`, 'info', index, proxyIP);
        
        for (const taskId of missingTasks) {
            const result = await this.claimTask(checksummedWallet, taskId, index, proxyIP);
            if (!result.success) {
                this.log(`Lỗi khi claim task ${taskId}: ${result.error}`, 'error', index, proxyIP);
            }
            await this.countdown(3);
        }
    }

    async registerUser(wallet, index, proxyIP, inviteCode = "UWUlyq12") {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return { success: false, error: "Invalid wallet address" };
        }

        const url = "https://mscore.onrender.com/user";
        const payload = { wallet: checksummedWallet, invite: inviteCode };

        try {
            const axiosInstance = this.getAxiosInstanceWithProxy(index);
            const response = await axiosInstance.post(url, payload);
            
            if (response.status === 201 && response.data.success) {
                const userData = response.data.user;
                return { 
                    success: true, 
                    data: {
                        score: userData.score,
                        totalPoints: userData.totalPoints,
                        nextTotalPoints: userData.nextTotalPoints,
                        startTime: userData.startTime,
                        activeDays: userData.activeDays,
                        referralCode: userData.referralCode,
                        checkInPoints: userData.checkInPoints,
                        wallet: userData.wallet,
                        claimedTasks: userData.claimedTasks || [],
                        referralCount: userData.referralCount || 0, // Thêm mặc định nếu không có
                        referralBy: userData.referralBy || "N/A" // Thêm mặc định nếu không có
                    }
                };
            } else {
                return { success: false, error: response.data.message || "Unknown error" };
            }
        } catch (error) {
            return { 
                success: false, 
                error: error.response ? error.response.data.message : error.message 
            };
        }
    }

    async updateStartTime(wallet, index, proxyIP) {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return { success: false, error: "Invalid wallet address" };
        }

        const url = "https://mscore.onrender.com/user/update-start-time";
        const currentTime = Date.now();
        const payload = { wallet: checksummedWallet, startTime: currentTime };

        try {
            const axiosInstance = this.getAxiosInstanceWithProxy(index);
            const response = await axiosInstance.put(url, payload);
            
            return { 
                success: true, 
                data: response.data,
                startTime: currentTime
            };
        } catch (error) {
            return { 
                success: false, 
                error: error.response ? error.response.data.message : error.message 
            };
        }
    }

    async checkAndUpdateStartTime(wallet, startTime, index, proxyIP) {
        const checksummedWallet = this.getChecksummedWallet(wallet);
        if (!checksummedWallet) {
            return { success: false, error: "Invalid wallet address" };
        }

        if (!startTime || startTime === 0) {
            this.log(`Start Time = 0, cần cập nhật...`, 'warning', index, proxyIP);
            const updateResult = await this.updateStartTime(checksummedWallet, index, proxyIP);
            
            if (updateResult.success) {
                this.log(`Run node thành công!`, 'success', index, proxyIP);
                this.log(`New Start Time: ${updateResult.startTime}`, 'custom', index, proxyIP);
                return { ...updateResult, nextUpdate: null };
            } else {
                this.log(`Không thể cập nhật start time: ${updateResult.error}`, 'error', index, proxyIP);
                return updateResult;
            }
        } else {
            this.log(`Node đang chạy với Start Time: ${startTime}`, 'success', index, proxyIP);
            return { success: true, status: "running", nextUpdate: null };
        }
    }

    async processWallets(wallets, concurrencyLimit = 5) {
        const nextUpdates = [];
        const outputFile = path.join(__dirname, 'output.txt');
        
        const processWallet = async (wallet, index) => {
            const checksummedWallet = this.getChecksummedWallet(wallet);
            if (!checksummedWallet) {
                this.log(`Bỏ qua ví ${wallet} do định dạng không hợp lệ`, 'error', index);
                return null;
            }

            const proxy = this.getProxyForIndex(index);
            let proxyIP = "không có proxy";
            
            try {
                proxyIP = await this.checkProxyIP(proxy);
                this.log(`Proxy IP: ${proxyIP}`, 'success', index, proxyIP);
            } catch (error) {
                this.log(`Không thể kiểm tra IP của proxy: ${error.message}`, 'warning', index, proxyIP);
                this.log(`Bỏ qua ví ${checksummedWallet} do proxy không hoạt động`, 'warning', index, proxyIP);
                return null;
            }
            
            this.log(`Đang authenticate ví ${checksummedWallet}...`, 'info', index, proxyIP);
            const authResult = await this.authenticateUser(checksummedWallet, index, proxyIP);
            
            if (!authResult.success) {
                this.log(`Authentication thất bại: ${authResult.error}`, 'error', index, proxyIP);
                return null;
            }
    
            this.log(`Đang lấy thông tin ví ${checksummedWallet}...`, 'info', index, proxyIP);
            const userInfo = await this.getUserInfo(checksummedWallet, index, proxyIP);
            
            if (userInfo.success) {
                this.log('Lấy thông tin ví thành công!', 'success', index, proxyIP);
                this.log(`Score: ${userInfo.data.score}`, 'custom', index, proxyIP);
                this.log(`Total Points: ${userInfo.data.totalPoints}`, 'custom', index, proxyIP);
                this.log(`Next Total Points: ${userInfo.data.nextTotalPoints}`, 'custom', index, proxyIP);
                this.log(`Start Time: ${userInfo.data.startTime}`, 'custom', index, proxyIP);
                this.log(`Active Days: ${userInfo.data.activeDays}`, 'custom', index, proxyIP);
                this.log(`Referral Code: ${userInfo.data.referralCode}`, 'info', index, proxyIP);
                this.log(`Referraled Code: ${userInfo.data.referredBy}`, 'info', index, proxyIP);
                this.log(`Referral Count: ${userInfo.data.referCounter }`, 'info', index, proxyIP);
                this.log(`Pending Refer Counter: ${userInfo.data.pendingReferCounter}`, 'info', index, proxyIP);
                this.log(`Check-in Points: ${userInfo.data.checkInPoints}`, 'info', index, proxyIP);
                
                // Ghi referral info vào file refCode.txt
                const refLine = `${index},${checksummedWallet},${userInfo.data.referralCode},${userInfo.data.referralCount || 0},${userInfo.data.pendingReferCounter || 0},${userInfo.data.referredBy  || 'N/A'}\n`;
                fs.appendFileSync(outputFile, refLine);
                
                const claimedTasks = userInfo.data.claimedTasks || [];
                await this.handleTasks(checksummedWallet, claimedTasks, index, proxyIP);
                
                const updateResult = await this.checkAndUpdateStartTime(checksummedWallet, userInfo.data.startTime, index, proxyIP);
                if (updateResult.nextUpdate) {
                    nextUpdates.push(updateResult.nextUpdate);
                }
            } else 
            {
                this.log(`Không thể lấy thông tin ví: ${userInfo.error}`, 'warning', index, proxyIP);
            }
        };

        const chunkArray = (array, size) => {
            const result = [];
            for (let i = 0; i < array.length; i += size) {
                result.push(array.slice(i, i + size));
            }
            return result;
        };

        const walletChunks = chunkArray(wallets, concurrencyLimit);

        for (const chunk of walletChunks) {
            const promises = chunk.map((wallet, idx) => {
                const globalIndex = wallets.indexOf(wallet);
                return processWallet(wallet, globalIndex);
            });

            await Promise.all(promises);
            this.log(`Đã xử lý xong một batch gồm ${chunk.length} ví`, 'success');
            await this.countdown(2);
        }

        return nextUpdates;
    }

    async main() {
        const walletFile = path.join(__dirname, 'wallet.txt');
        const wallets = fs.readFileSync(walletFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        this.log("Dân cày airdrop - Đã sợ thì đừng dùng, đã dùng thì đừng sợ...", 'info');

        // Run indefinitely with sleep between rounds
        while (true) {
            try {
                await this.processWallets(wallets, 30);
                this.log("Hoàn thành xử lý tất cả các ví!", 'success');

                // Calculate sleep time: 7 hours 15 minutes = (7 * 60 * 60 + 15 * 60) = 26,100 seconds
                const sleepSeconds = 7 * 60 * 60 + 15 * 60; // 26,100 seconds
                this.log(`Đang nghỉ 7 giờ 15 phút trước round tiếp theo...`, 'info');
                
                // Show countdown during sleep
                await this.countdown(sleepSeconds);
                this.log(`Bắt đầu round mới...`, 'info');
            } catch (err) {
                this.log(`Lỗi trong quá trình chạy: ${err.message}`, 'error');
                // Wait 5 minutes before retrying if there's an error
                await this.countdown(300);
            }
        }
    }
}

const client = new MonadAPIClient();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});
