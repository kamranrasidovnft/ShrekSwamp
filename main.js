import { Buffer } from "buffer";
window.Buffer = window.Buffer || Buffer;
import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

// ==========================================
// KONFİQURASİYA
// ==========================================
const API_URL = import.meta.env.VITE_BACKEND_URL || ""; 
const CONTRACT_ADDR = "0xc291adb9516a1377bb0ab369ef240488adfaa4bc";
const SEAPORT_ADDR = "0x0000000000000068f116a894984e2db1123eb395";
const CHAIN_ID = 33139; // ApeChain
const RPC_URL = "https://rpc.apechain.com";

const ItemType = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3 };
const OrderType = { FULL_OPEN: 0 };
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// STATE
let provider, signer, seaport, userAddr;
let allNFTs = [];
let rarityDB = {};
let apePrice = 0;
let currentFilter = 'all';
let currentSort = 'price_asc';

// ==========================================
// APP OBYEKTİ (UI & ROUTING)
// ==========================================
window.app = {
    // Naviqasiya
    router: (page) => {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${page}`).classList.add('active');
        
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
        const activeLink = Array.from(document.querySelectorAll('.nav-link')).find(l => l.getAttribute('onclick').includes(page));
        if(activeLink) activeLink.classList.add('active');

        if(page === 'home') renderDashboard();
        if(page === 'wallet') updateWalletUI();
        if(page === 'marketplace') renderMarket();
    },

    // Dashboard Timeframe
    dashTime: (time, btn) => {
        document.querySelectorAll('.time-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderDashboard(); // Re-randomize data
    },

    // Wallet Tabs
    walletTab: (tab) => {
        const sendDiv = document.getElementById('tab-send');
        const recvDiv = document.getElementById('tab-receive');
        const btns = document.querySelectorAll('.w-tab');
        btns.forEach(b => b.classList.remove('active'));
        
        if(tab === 'send') {
            sendDiv.style.display = 'block';
            recvDiv.style.display = 'none';
            btns[0].classList.add('active');
        } else {
            sendDiv.style.display = 'none';
            recvDiv.style.display = 'block';
            btns[1].classList.add('active');
            if(userAddr) {
                document.getElementById('qrImg').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${userAddr}`;
            }
        }
    },

    // Send Coin
    sendCoin: async () => {
        const to = document.getElementById('sendAddr').value;
        const amt = document.getElementById('sendAmt').value;
        if(!signer) return alert("Cüzdanı qoşun!");
        if(!to || !amt) return alert("Xanaları doldurun");

        try {
            const tx = await signer.sendTransaction({
                to: to, value: ethers.utils.parseEther(amt)
            });
            alert("Göndərildi! Tx: " + tx.hash);
        } catch(e) { alert("Xəta: " + e.message); }
    },

    copyAddr: () => {
        if(userAddr) navigator.clipboard.writeText(userAddr);
        alert("Kopyalandı");
    },

    // Marketplace Filters
    filterMarket: (type, btn) => {
        currentFilter = type;
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderMarket();
    },
    sortMarket: (val) => {
        currentSort = val;
        renderMarket();
    },

    // FREE MINT FUNCTION
    doFreeMint: async () => {
        if(!userAddr) return alert("Zəhmət olmasa cüzdanı qoşun!");
        const btn = document.getElementById('mintBtn');
        const resDiv = document.getElementById('mintResult');
        
        btn.disabled = true;
        btn.innerText = "MINTING...";
        resDiv.innerText = "";

        try {
            const req = await fetch(`${API_URL}/api/freemint`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ address: userAddr })
            });
            const data = await req.json();
            
            if(data.success) {
                resDiv.innerText = `Uğurlu! NFT #${data.tokenid} qazandınız!`;
                resDiv.style.color = "green";
                await loadData(); // Reload data
            } else {
                resDiv.innerText = data.error || "Xəta baş verdi";
                resDiv.style.color = "red";
            }
        } catch(e) {
            resDiv.innerText = "Server xətası";
            resDiv.style.color = "red";
        }
        btn.disabled = false;
        btn.innerText = "MINT NOW (FREE)";
    }
};

// ==========================================
// INIT & DATA LOADING
// ==========================================
async function init() {
    // 1. APE Price fetch
    try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=apecoin&vs_currencies=usd');
        const d = await r.json();
        if(d.apecoin) apePrice = d.apecoin.usd;
    } catch(e) {}

    // 2. Rarity Data
    try {
        const r = await fetch('/rarity_data.json');
        rarityDB = await r.json();
    } catch(e) {}

    // 3. NFTs
    await loadData();
    renderDashboard();

    // Check Wallet
    if(window.ethereum) {
        document.getElementById('connectBtn').onclick = connectWallet;
        document.getElementById('disconnectBtn').onclick = () => window.location.reload();
    }
}

async function loadData() {
    try {
        const r = await fetch(`${API_URL}/api/nfts`);
        const d = await r.json();
        allNFTs = d.nfts || [];
    } catch(e) { console.error("NFT load error", e); }
}

// ==========================================
// DASHBOARD LOGIC (FAKE DATA GEN)
// ==========================================
function renderDashboard() {
    const tbody = document.getElementById('dashTableBody');
    tbody.innerHTML = "";
    
    // Top 50 Fake Data
    let data = [
        { name: "Bored Ape Yacht Club", floor: 12.4, vol: 15400, supply: 10000 },
        { name: "Mutant Ape Yacht Club", floor: 4.1, vol: 8200, supply: 20000 },
        { name: "Steptract Genesis", floor: 2.5, vol: 5400, supply: 2222 }, // Bizim kolleksiya
        { name: "Otherside Koda", floor: 1.8, vol: 3100, supply: 10000 },
        { name: "Ape Kennel Club", floor: 1.2, vol: 2200, supply: 9600 },
    ];

    for(let i=6; i<=50; i++) {
        data.push({
            name: `Ape Collection #${i}`,
            floor: (Math.random() * 3).toFixed(2),
            vol: Math.floor(Math.random() * 1000),
            supply: Math.floor(Math.random() * 5000 + 1000)
        });
    }

    // Sort by Volume
    data.sort((a,b) => b.vol - a.vol);

    data.forEach((item, idx) => {
        const change = (Math.random() * 20 - 10).toFixed(2);
        const colorClass = change >= 0 ? 'green-stat' : 'red-stat';
        
        tbody.innerHTML += `
            <tr>
                <td><span class="rank-num">${idx+1}</span></td>
                <td>${item.name}</td>
                <td>${item.vol} APE <span style="font-size:11px" class="${colorClass}">(${change}%)</span></td>
                <td>${item.floor} APE</td>
                <td>${Math.floor(item.vol / item.floor)}</td>
                <td>${item.supply}</td>
            </tr>
        `;
    });
}

// ==========================================
// WALLET LOGIC
// ==========================================
async function connectWallet() {
    if(!window.ethereum) return alert("Metamask yoxdur!");
    provider = new ethers.providers.Web3Provider(window.ethereum);
    
    const { chainId } = await provider.getNetwork();
    if(chainId !== CHAIN_ID) {
        try {
            await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [{
                    chainId: "0x8173", chainName: "ApeChain Mainnet",
                    nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
                    rpcUrls: [RPC_URL], blockExplorerUrls: ["https://apescan.io"]
                }]
            });
            provider = new ethers.providers.Web3Provider(window.ethereum);
        } catch(e) { return alert("Şəbəkə xətası"); }
    }

    const accounts = await provider.send("eth_requestAccounts", []);
    userAddr = accounts[0].toLowerCase();
    signer = provider.getSigner();
    seaport = new Seaport(signer, { overrides: { contractAddress: SEAPORT_ADDR } });

    // UI Updates
    document.getElementById('connectBtn').style.display = "none";
    document.getElementById('disconnectBtn').style.display = "inline-block";
    document.getElementById('walletAddr').innerText = userAddr;
    
    updateWalletUI();
    renderMarket(); // Re-render for owner buttons
}

async function updateWalletUI() {
    if(!userAddr) return;
    
    // Balans
    const bal = await provider.getBalance(userAddr);
    const eth = ethers.utils.formatEther(bal);
    const numBal = parseFloat(eth);
    document.getElementById('walletBal').innerText = numBal.toFixed(4) + " APE";
    document.getElementById('walletBalUsd').innerText = "$" + (numBal * apePrice).toFixed(2);

    // My NFTs Grid
    const myGrid = document.getElementById('myNFTs');
    myGrid.innerHTML = "";
    
    const myItems = allNFTs.filter(n => {
        const isBuyer = n.buyer_address && n.buyer_address.toLowerCase() === userAddr;
        const isSeller = n.seller_address && n.seller_address.toLowerCase() === userAddr;
        return isBuyer || isSeller;
    });

    if(myItems.length === 0) myGrid.innerHTML = "<div>NFT yoxdur</div>";
    
    myItems.forEach(nft => {
        myGrid.appendChild(createNFTCard(nft, true));
    });
}

// ==========================================
// MARKETPLACE RENDER LOGIC
// ==========================================
function renderMarket() {
    const grid = document.getElementById('marketGrid');
    grid.innerHTML = "";

    let list = allNFTs.filter(n => {
        const price = parseFloat(n.price || 0);
        if(currentFilter === 'listed' && price <= 0) return false;
        if(currentFilter === 'unlisted' && price > 0) return false;
        return true;
    });

    list.sort((a,b) => {
        const pA = parseFloat(a.price||0);
        const pB = parseFloat(b.price||0);
        
        if(currentSort === 'price_asc') {
            if(pA > 0 && pB > 0) return pA - pB;
            if(pA > 0) return -1; 
            return 1;
        }
        if(currentSort === 'price_desc') return pB - pA;
        return 0; // rarity logic omitted for brevity
    });

    list.forEach(nft => {
        grid.appendChild(createNFTCard(nft, false));
    });
}

function createNFTCard(nft, isWalletMode) {
    const div = document.createElement('div');
    const rInfo = rarityDB[nft.tokenid] || { type: 'common', rank: '?' };
    div.className = `nft-card ${rInfo.type}`;
    
    const price = parseFloat(nft.price || 0);
    const isOwner = (nft.seller_address?.toLowerCase() === userAddr) || 
                    (!nft.seller_address && nft.buyer_address?.toLowerCase() === userAddr);

    let actionHTML = "";
    if(userAddr) {
        if(isOwner) {
            actionHTML = `<button class="card-btn btn-list" onclick="window.sellNFT('${nft.tokenid}')">
                ${price > 0 ? 'Qiyməti Dəyiş' : 'Satışa Qoy'}
            </button>`;
        } else if(price > 0) {
            actionHTML = `<button class="card-btn btn-buy" onclick="window.buyNFT('${nft.tokenid}', ${price})">
                AL (${price} APE)
            </button>`;
        } else {
            actionHTML = `<div style="text-align:center; font-size:12px; color:#aaa; margin-top:10px;">Satışda deyil</div>`;
        }
    }

    div.innerHTML = `
        <div class="rarity-tag" style="background:${getRankColor(rInfo.type)}">${rInfo.type} #${rInfo.rank}</div>
        <div style="height:150px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; font-size:40px;">🦍</div>
        <div class="card-body">
            <div class="card-name">Steptract #${nft.tokenid}</div>
            <div style="font-size:12px; color:#888;">Rank: ${rInfo.rank}</div>
            <div class="card-price">${price > 0 ? price + ' APE' : ''}</div>
            ${actionHTML}
        </div>
    `;
    return div;
}
function getRankColor(type) {
    if(type === 'legendary') return '#f97316';
    if(type === 'epic') return '#a855f7';
    if(type === 'rare') return '#3b82f6';
    return '#94a3b8';
}

// ==========================================
// SEAPORT TRANSACTIONS (LIST & BUY)
// ==========================================

// 1. LIST (SELL)
window.sellNFT = async (tokenId) => {
    const priceStr = prompt("Qiyməti daxil edin (USD):");
    if(!priceStr) return;
    const usdVal = parseFloat(priceStr);
    
    if(!apePrice) { alert("APE qiyməti yüklənməyib"); return; }
    
    const apeAmount = (usdVal / apePrice).toFixed(2);
    if(!confirm(`${usdVal} USD = ~${apeAmount} APE. Davam edilsin?`)) return;

    try {
        // Approve
        const nftContract = new ethers.Contract(CONTRACT_ADDR, 
            ["function setApprovalForAll(address,bool)", "function isApprovedForAll(address,address) view returns(bool)"], 
            signer);
        
        const isApproved = await nftContract.isApprovedForAll(userAddr, SEAPORT_ADDR);
        if(!isApproved) {
            const tx = await nftContract.setApprovalForAll(SEAPORT_ADDR, true);
            await tx.wait();
        }

        // Create Order
        const priceWei = ethers.utils.parseEther(apeAmount.toString());
        const startTime = Math.floor(Date.now()/1000).toString();
        const endTime = (Math.floor(Date.now()/1000) + 31536000).toString();

        const { executeAllActions } = await seaport.createOrder({
            offer: [{ itemType: ItemType.ERC721, token: CONTRACT_ADDR, identifier: tokenId }],
            consideration: [{ itemType: ItemType.NATIVE, amount: priceWei.toString(), recipient: userAddr }],
            startTime, endTime
        });

        const order = await executeAllActions();
        
        // Save to DB
        await fetch(`${API_URL}/api/order`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                tokenid: tokenId,
                price: apeAmount,
                seller_address: userAddr,
                seaport_order: order,
                order_hash: seaport.getOrderHash(order.parameters)
            })
        });

        alert("Uğurla listələndi!");
        await loadData();
        renderMarket();
        updateWalletUI();

    } catch(e) { console.error(e); alert("Xəta: " + e.message); }
};

// 2. BUY
window.buyNFT = async (tokenId, priceVal) => {
    const nft = allNFTs.find(n => n.tokenid == tokenId);
    if(!nft || !nft.seaport_order) return alert("Order tapılmadı");
    
    if(!confirm(`${priceVal} APE ödəyərək almaq istəyirsiz?`)) return;

    try {
        const { actions } = await seaport.fulfillOrder({
            order: nft.seaport_order,
            accountAddress: userAddr
        });

        const tx = await actions[0].transactionMethods.buildTransaction();
        const sentTx = await signer.sendTransaction({
            to: tx.to, data: tx.data, value: tx.value
        });
        await sentTx.wait();

        // Update DB
        await fetch(`${API_URL}/api/buy`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                tokenid: tokenId,
                buyer_address: userAddr,
                price: priceVal,
                seller: nft.seller_address
            })
        });

        alert("Təbriklər! Satın alındı.");
        await loadData();
        renderMarket();
        updateWalletUI();

    } catch(e) { console.error(e); alert("Alış xətası: " + e.message); }
};

init();
