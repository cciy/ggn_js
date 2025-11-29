// ==UserScript==
// @name         The Lounge 手机/PC通用增强版 (API修复+黑名单)
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  修复“不支持跨域请求”错误。适配手机，支持翻译/引用/黑名单/跳转保底。
// @author       Gemini
// @match        https://i.uddd.de/*
// @match        http://i.uddd.de/*
// @connect      translate.googleapis.com
// @connect      google.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_openInTab
// ==/UserScript==
(function() {
'use strict';

    // ==========================================
    // 【配置区域】黑名单
    // ==========================================
    const IGNORED_USERS = [
        'Vertigo',
        'ChanServ',
        'NickServ',
    ];
    // ==========================================

    console.log("【The Lounge V15】启动 (内部对齐模式)...");

    // ==========================================
    // 1. 样式注入
    // ==========================================
    function injectStyles() {
        const css = `
            /* === 按钮容器 (紧跟在文字后面) === */
            .my-tl-actions {
                display: inline-block;
                margin-left: 8px;
                vertical-align: middle;
                user-select: none;
            }

            /* === 翻译结果行 (嵌入在内容内部，从而实现对齐) === */
            .my-trans-pure {
                display: block;        /* 强制换行 */
                margin-top: 6px;       /* 拉开间距 */
                padding-top: 4px;
                border-top: 1px dashed rgba(120, 120, 120, 0.3); /* 虚线分割 */

                color: #ff9800;        /* 橙色高亮 */
                font-size: 1.05em;
                line-height: 1.5;
                white-space: pre-wrap;
                word-wrap: break-word;
                clear: both;           /* 清除浮动 */
            }

            /* 暗黑模式适配 */
            @media (prefers-color-scheme: dark) {
                .my-trans-pure { color: #81d4fa; border-top-color: rgba(255,255,255,0.15); }
            }
            body.theme-dark .my-trans-pure { color: #81d4fa; border-top-color: rgba(255,255,255,0.15); }


            /* === 电脑端 PC (鼠标悬停显示按钮) === */
            @media (min-width: 769px) {
                /* 默认完全隐藏 */
                .my-tl-actions {
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                /* 只有鼠标移到这一行消息时，才显示按钮 */
                div.msg:hover .my-tl-actions {
                    opacity: 1;
                }

                /* 极简文字按钮 */
                .my-tl-btn {
                    cursor: pointer;
                    color: #999;
                    margin-right: 8px;
                    font-size: 12px;
                    padding: 0 2px;
                }
                .my-tl-btn:hover {
                    color: #2196f3;
                    text-decoration: underline;
                }
            }

            /* === 手机端 Mobile (一直显示) === */
            @media (max-width: 768px) {
                .my-tl-actions {
                    opacity: 1 !important;
                    margin-top: 4px;
                    display: block; /* 手机上防止太挤，允许按钮换行 */
                }
                .my-tl-btn {
                    display: inline-block;
                    padding: 4px 10px;
                    margin-right: 8px;
                    border: 1px solid #ccc;
                    border-radius: 12px;
                    font-size: 13px;
                }
            }
        `;
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = css;
        document.head.appendChild(style);
    }

    // ==========================================
    // 2. 跨域请求
    // ==========================================
    function safeRequest(url, onload, onerror) {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({ method: "GET", url: url, onload: onload, onerror: onerror });
        } else if (typeof GM !== 'undefined' && GM.xmlHttpRequest) {
            GM.xmlHttpRequest({ method: "GET", url: url, onload: onload, onerror: onerror });
        } else {
            throw new Error("NoAPI");
        }
    }

    // ==========================================
    // 3. 核心功能
    // ==========================================
    function doTranslate(text, container, webUrl) {
        if (!text) return;
        container.innerHTML = '<span style="color:#888;font-size:0.9em;">...</span>';

        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;

        try {
            safeRequest(apiUrl,
                (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        let str = "";
                        if(data && data[0]) data[0].forEach(s => { if(s[0]) str += s[0]; });
                        container.textContent = str || "无结果";
                    } catch(e) {
                        container.innerHTML = `<a href="${webUrl}" target="_blank" style="color:red;font-size:12px">解析错</a>`;
                    }
                },
                (err) => {
                    container.innerHTML = `<a href="${webUrl}" target="_blank" style="color:red;font-size:12px">请求被阻</a>`;
                }
            );
        } catch (e) {
            container.innerHTML = `<a href="${webUrl}" target="_blank" style="color:red;font-size:12px">无权限</a>`;
        }
    }

    function doQuote(username, text) {
        const input = document.getElementById('input');
        if (!input) return;
        let processedText = text.length > 150 ? text.substring(0, 150) + "..." : text;
        const quoteStr = ` - [${username}]: ${processedText} `;
        input.value = (input.value ? input.value + " " : "") + quoteStr;
        input.focus();
        input.setSelectionRange(0, 0);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ==========================================
    // 4. DOM 处理 (关键修正：全部插入到 content 内部)
    // ==========================================
    function processMsg(node) {
        if (node.querySelector('.my-tl-actions')) return;
        if (node.getAttribute('data-type') !== 'message') return;

        const rawUsername = node.getAttribute('data-from');
        if (rawUsername && IGNORED_USERS.includes(rawUsername)) {
            node.setAttribute('data-tl-ignored', 'true');
            return;
        }

        // 获取内容容器
        const contentEl = node.querySelector('.content');
        if (!contentEl) return;

        // 1. 创建按钮容器
        const actionSpan = document.createElement('span');
        actionSpan.className = 'my-tl-actions';

        const btnT = document.createElement('span');
        btnT.innerText = '[翻译]';
        btnT.className = 'my-tl-btn';
        btnT.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            toggleTranslate(contentEl); // 注意：这里只传 contentEl
        };

        const btnQ = document.createElement('span');
        btnQ.innerText = '[引用]';
        btnQ.className = 'my-tl-btn';
        btnQ.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            // 引用时需要排除掉我们的翻译块和按钮
            const clone = contentEl.cloneNode(true);
            const garbage = clone.querySelectorAll('.my-tl-actions, .my-trans-pure');
            garbage.forEach(g => g.remove());
            doQuote(rawUsername || "User", clone.innerText.trim());
        };

        actionSpan.appendChild(btnT);
        actionSpan.appendChild(btnQ);

        // 【关键修正点】
        // 直接追加到 .content 内部！
        // 这样按钮就在文字后面，翻译块就在文字下面（并且是对齐的）
        contentEl.appendChild(actionSpan);
    }

    // 切换翻译显示
    function toggleTranslate(contentEl) {
        let transDiv = contentEl.querySelector('.my-trans-pure');

        if (!transDiv) {
            transDiv = document.createElement('div');
            transDiv.className = 'my-trans-pure';
            transDiv.textContent = "翻译中...";

            // 追加到 .content 内部的最后
            contentEl.appendChild(transDiv);

            // 获取原文：需要克隆并去除按钮
            const clone = contentEl.cloneNode(true);
            const garbage = clone.querySelectorAll('.my-tl-actions, .my-trans-pure');
            garbage.forEach(g => g.remove());
            const text = clone.innerText.trim();

            const webUrl = `https://translate.google.com/?sl=auto&tl=zh-CN&text=${encodeURIComponent(text)}&op=translate`;
            doTranslate(text, transDiv, webUrl);
        } else {
            transDiv.style.display = (transDiv.style.display === 'none') ? 'block' : 'none';
        }
    }

    // ==========================================
    // 5. 启动
    // ==========================================
    injectStyles();

    function scan() {
        document.querySelectorAll('div.msg[data-type="message"]:not([data-tl-ignored])').forEach(processMsg);
    }

    const observer = new MutationObserver(scan);
    setTimeout(() => {
        scan();
        observer.observe(document.body, { childList: true, subtree: true });
    }, 1000);

  // --- 1. 海量表情库 (含 simplemap 兼容 + 中文 + 英文关键词) ---
  // 在 cn 字段中追加了英文，方便搜索
  // --- 1. Massive Emoji Library (Includes simplemap compatibility + Chinese + English keywords) ---
  // Added English terms to the cn field for easier searching
const emojiDatabase = [
    // --- 😀 表情与情感 (Smilies & Emotion) ---
    { char: "😀", keys: [":D", "grin"], cn: "大笑 嘿嘿 开心" },
    { char: "😃", keys: ["smiley"], cn: "笑脸 哈哈" },
    { char: "😄", keys: ["smile"], cn: "开心 愉快" },
    { char: "😁", keys: ["beam"], cn: "龇牙笑 嘻嘻" },
    { char: "😆", keys: ["laugh"], cn: "爆笑 眯眼笑" },
    { char: "😅", keys: ["sweat_smile"], cn: "汗颜 尴尬笑" },
    { char: "🤣", keys: ["rofl"], cn: "笑滚 笑死 地板" },
    { char: "😂", keys: ["joy"], cn: "笑哭 感动 哈哈" },
    { char: "🙂", keys: [":)", "smile"], cn: "微笑 呵呵" },
    { char: "🙃", keys: ["upside_down"], cn: "倒脸 无语 呵呵" },
    { char: "😉", keys: [";)", "wink"], cn: "眨眼 使眼色" },
    { char: "😊", keys: ["blush"], cn: "害羞 脸红" },
    { char: "😇", keys: ["innocent"], cn: "天使 乖" },
    { char: "🥰", keys: ["love"], cn: "爱 喜欢 暖" },
    { char: "😍", keys: ["heart_eyes"], cn: "色 喜欢 爱心眼" },
    { char: "🤩", keys: ["star_eyes"], cn: "星星眼 崇拜" },
    { char: "😘", keys: [":*", "kiss"], cn: "亲亲 飞吻 么么哒" },
    { char: "😗", keys: ["kissing"], cn: "亲 嘟嘴" },
    { char: "😚", keys: ["kissing_closed_eyes"], cn: "闭眼亲" },
    { char: "😙", keys: ["kissing_smiling_eyes"], cn: "微笑亲" },
    { char: "😋", keys: ["yum"], cn: "好吃 馋 吐舌" },
    { char: "😛", keys: [":p", "tongue"], cn: "吐舌 调皮" },
    { char: "😜", keys: [";p"], cn: "眨眼吐舌 搞怪" },
    { char: "🤪", keys: ["zany"], cn: "滑稽 疯了 傻" },
    { char: "😝", keys: ["squint"], cn: "眯眼吐舌 难受" },
    { char: "🤑", keys: ["money"], cn: "钱 发财 美滋滋" },
    { char: "🤗", keys: ["hug"], cn: "抱抱 拥抱" },
    { char: "🤭", keys: ["hand_over_mouth"], cn: "偷笑 捂嘴" },
    { char: "🤫", keys: ["shushing"], cn: "嘘 安静" },
    { char: "🤔", keys: ["think"], cn: "思考 想 怀疑" },
    { char: "🤐", keys: ["zipper"], cn: "闭嘴 拉链" },
    { char: "🤨", keys: ["raised_eyebrow"], cn: "挑眉 怀疑" },
    { char: "😐", keys: [":|", "neutral"], cn: "无语 直线" },
    { char: "😑", keys: ["expressionless"], cn: "面无表情 呆" },
    { char: "😶", keys: [":x", "silent"], cn: "沉默 没有嘴" },
    { char: "😏", keys: ["smirk"], cn: "坏笑 得意" },
    { char: "😒", keys: ["unamused"], cn: "不屑 哼" },
    { char: "🙄", keys: ["roll_eyes"], cn: "翻白眼 无语" },
    { char: "😬", keys: ["grimacing"], cn: "尴尬 龇牙" },
    { char: "🤥", keys: ["lying"], cn: "说谎 鼻子长" },
    { char: "😌", keys: ["relieved"], cn: "欣慰 佛系" },
    { char: "😔", keys: ["pensive"], cn: "失落 难过 沉思" },
    { char: "😪", keys: ["sleepy"], cn: "困 鼻涕" },
    { char: "🤤", keys: ["drool"], cn: "流口水 色" },
    { char: "😴", keys: ["sleeping"], cn: "睡觉 呼噜" },
    { char: "😷", keys: ["mask"], cn: "口罩 生病" },
    { char: "🤒", keys: ["thermometer"], cn: "发烧 温度计" },
    { char: "🤕", keys: ["bandage"], cn: "受伤 绷带" },
    { char: "🤢", keys: ["nauseated"], cn: "恶心 想吐" },
    { char: "🤮", keys: ["vomit"], cn: "吐 呕吐" },
    { char: "🤧", keys: ["sneeze"], cn: "喷嚏 感冒" },
    { char: "🥵", keys: ["hot"], cn: "热 脸红" },
    { char: "🥶", keys: ["cold"], cn: "冷 结冰" },
    { char: "🥴", keys: ["woozy"], cn: "晕 醉" },
    { char: "😵", keys: ["dizzy"], cn: "晕死 懵" },
    { char: "🤯", keys: ["exploding"], cn: "爆炸 震惊" },
    { char: "🤠", keys: ["cowboy"], cn: "牛仔" },
    { char: "🥳", keys: ["party"], cn: "庆祝 派对" },
    { char: "😎", keys: ["B)", "cool"], cn: "酷 墨镜" },
    { char: "🤓", keys: ["nerd"], cn: "书呆子 眼镜" },
    { char: "🧐", keys: ["monocle"], cn: "观察 单片眼镜" },
    { char: "😕", keys: [":/", "confused"], cn: "困惑 撇嘴" },
    { char: "😟", keys: ["worried"], cn: "担心" },
    { char: "🙁", keys: [":(", "frown"], cn: "难过 不开心" },
    { char: "😮", keys: [":o", "open_mouth"], cn: "惊讶 张嘴" },
    { char: "😯", keys: ["hushed"], cn: "嘘 惊讶" },
    { char: "😲", keys: ["astonished"], cn: "震惊" },
    { char: "😳", keys: ["flushed"], cn: "脸红 尴尬" },
    { char: "🥺", keys: ["pleading"], cn: "求求 可怜 委屈" },
    { char: "😦", keys: ["frowning"], cn: "皱眉" },
    { char: "😨", keys: ["fearful"], cn: "害怕" },
    { char: "😰", keys: ["cold_sweat"], cn: "冷汗 紧张" },
    { char: "😥", keys: ["disappointed_relieved"], cn: "汗 失望" },
    { char: "😢", keys: [":'(", "cry"], cn: "哭 泪" },
    { char: "😭", keys: ["sob"], cn: "大哭 泪流" },
    { char: "😱", keys: ["scream"], cn: "尖叫 吓死" },
    { char: "😖", keys: [":s", "confounded"], cn: "纠结 难受" },
    { char: "😣", keys: ["persevere"], cn: "忍耐 痛苦" },
    { char: "😞", keys: ["disappointed"], cn: "失望" },
    { char: "😓", keys: ["sweat"], cn: "汗流浃背" },
    { char: "😩", keys: ["weary"], cn: "累 哀嚎" },
    { char: "😫", keys: ["tired"], cn: "累死" },
    { char: "🥱", keys: ["yawn"], cn: "哈欠 困" },
    { char: "😤", keys: ["triumph"], cn: "傲慢 喷气 生气" },
    { char: "😡", keys: ["rage"], cn: "愤怒 红脸" },
    { char: "😠", keys: [">:(", "angry"], cn: "生气" },
    { char: "🤬", keys: ["cursing"], cn: "骂人 脏话" },
    { char: "😈", keys: ["smile_horns"], cn: "恶魔 坏笑" },
    { char: "👿", keys: ["imp"], cn: "恶魔 生气" },
    { char: "💀", keys: ["skull"], cn: "骷髅 死" },
    { char: "☠️", keys: ["bones"], cn: "骨头 海盗" },
    { char: "💩", keys: ["poop"], cn: "便便 屎" },
    { char: "🤡", keys: ["clown"], cn: "小丑" },
    { char: "👻", keys: ["ghost"], cn: "鬼 幽灵" },
    { char: "👽", keys: ["alien"], cn: "外星人" },
    { char: "🤖", keys: ["robot"], cn: "机器人" },
    { char: "💋", keys: ["kiss_mark"], cn: "吻唇印" },
    { char: "💌", keys: ["love_letter"], cn: "情书" },
    { char: "💘", keys: ["cupid"], cn: "丘比特箭" },
    { char: "💝", keys: ["gift_heart"], cn: "爱心礼物" },
    { char: "💖", keys: ["sparkling_heart"], cn: "闪亮爱心" },
    { char: "💗", keys: ["growing_heart"], cn: "跳动爱心" },
    { char: "💓", keys: ["beating_heart"], cn: "心跳" },
    { char: "💞", keys: ["revolving_hearts"], cn: "旋转爱心" },
    { char: "💕", keys: ["two_hearts"], cn: "两颗心" },
    { char: "💟", keys: ["heart_decoration"], cn: "爱心装饰" },
    { char: "❣️", keys: ["heart_exclamation"], cn: "爱心感叹号" },
    { char: "💔", keys: ["</3", "broken_heart"], cn: "心碎" },
    { char: "❤️", keys: ["<3", "heart"], cn: "爱心 红心" },
    { char: "🧡", keys: ["orange_heart"], cn: "橙心" },
    { char: "💛", keys: ["yellow_heart"], cn: "黄心" },
    { char: "💚", keys: ["green_heart"], cn: "绿心" },
    { char: "💙", keys: ["blue_heart"], cn: "蓝心" },
    { char: "💜", keys: ["purple_heart"], cn: "紫心" },
    { char: "🖤", keys: ["black_heart"], cn: "黑心" },
    { char: "🤍", keys: ["white_heart"], cn: "白心" },
    { char: "🤎", keys: ["brown_heart"], cn: "棕心" },
    { char: "💯", keys: ["100"], cn: "满分 一百" },
    { char: "💢", keys: ["anger"], cn: "怒 青筋" },
    { char: "💥", keys: ["boom"], cn: "爆炸" },
    { char: "💫", keys: ["dizzy_symbol"], cn: "晕 星星" },
    { char: "💦", keys: ["sweat_drops"], cn: "汗水 水滴" },
    { char: "💨", keys: ["dash"], cn: "快跑 放屁" },
    { char: "🕳️", keys: ["hole"], cn: "洞" },
    { char: "💤", keys: ["zzz"], cn: "睡觉" },

    // --- 👋 人物与手势 (People & Body) ---
    { char: "👋", keys: ["wave"], cn: "挥手 再见" },
    { char: "🤚", keys: ["back_hand"], cn: "手背" },
    { char: "🖐️", keys: ["hand_spread"], cn: "五指" },
    { char: "✋", keys: ["wait", "hand"], cn: "手 停止" },
    { char: "🖖", keys: ["vulcan"], cn: "瓦肯 敬礼" },
    { char: "👌", keys: ["ok"], cn: "好的 OK" },
    { char: "🤏", keys: ["pinching"], cn: "一点点 拿捏" },
    { char: "✌️", keys: ["peace"], cn: "耶 剪刀手 和平" },
    { char: "🤞", keys: ["crossed"], cn: "许愿 祝好运" },
    { char: "🤟", keys: ["love_you"], cn: "爱你 手势" },
    { char: "🤘", keys: ["rock"], cn: "摇滚 牛" },
    { char: "🤙", keys: ["call_me"], cn: "打电话 666" },
    { char: "👈", keys: ["point_left"], cn: "左 指" },
    { char: "👉", keys: ["point_right"], cn: "右 指" },
    { char: "👆", keys: ["point_up"], cn: "上 指" },
    { char: "🖕", keys: ["middle_finger"], cn: "中指" },
    { char: "👇", keys: ["point_down"], cn: "下 指" },
    { char: "👍", keys: ["(y)", "thumbsup"], cn: "赞 棒 强" },
    { char: "👎", keys: ["(n)", "thumbsdown"], cn: "踩 差 弱" },
    { char: "✊", keys: ["fist"], cn: "拳头" },
    { char: "👊", keys: ["punch"], cn: "击拳 打" },
    { char: "🤛", keys: ["left_fist"], cn: "左拳" },
    { char: "🤜", keys: ["right_fist"], cn: "右拳" },
    { char: "👏", keys: ["clap"], cn: "鼓掌 拍手" },
    { char: "🙌", keys: ["raised_hands"], cn: "举手 欢呼" },
    { char: "👐", keys: ["open_hands"], cn: "张开手" },
    { char: "🤲", keys: ["palms_up"], cn: "掌心向上" },
    { char: "🤝", keys: ["shake"], cn: "握手 合作" },
    { char: "🙏", keys: ["pray"], cn: "祈祷 谢谢 拜托" },
    { char: "✍️", keys: ["writing"], cn: "写字" },
    { char: "💅", keys: ["nail_polish"], cn: "指甲油" },
    { char: "🤳", keys: ["selfie"], cn: "自拍" },
    { char: "💪", keys: ["muscle"], cn: "肌肉 强壮 加油" },
    { char: "🦵", keys: ["leg"], cn: "腿" },
    { char: "🦶", keys: ["foot"], cn: "脚" },
    { char: "👂", keys: ["ear"], cn: "耳朵 听" },
    { char: "👃", keys: ["nose"], cn: "鼻子 闻" },
    { char: "🧠", keys: ["brain"], cn: "脑子" },
    { char: "🦷", keys: ["tooth"], cn: "牙齿" },
    { char: "🦴", keys: ["bone"], cn: "骨头" },
    { char: "👀", keys: ["eyes"], cn: "眼睛 偷看" },
    { char: "👶", keys: ["baby"], cn: "宝宝 婴儿" },
    { char: "👧", keys: ["girl"], cn: "女孩" },
    { char: "🧒", keys: ["child"], cn: "孩子" },
    { char: "👦", keys: ["boy"], cn: "男孩" },
    { char: "👩", keys: ["woman"], cn: "女人" },
    { char: "🧑", keys: ["person"], cn: "人" },
    { char: "👨", keys: ["man"], cn: "男人" },
    { char: "👱‍♀️", keys: ["blonde_woman"], cn: "金发女" },
    { char: "👱‍♂️", keys: ["blonde_man"], cn: "金发男" },
    { char: "🧔", keys: ["bearded"], cn: "胡子男" },
    { char: "👵", keys: ["older_woman"], cn: "老奶奶" },
    { char: "🧓", keys: ["older_person"], cn: "老人" },
    { char: "👴", keys: ["older_man"], cn: "老爷爷" },
    { char: "👲", keys: ["chinese_cap"], cn: "瓜皮帽" },
    { char: "👮‍♀️", keys: ["police_woman"], cn: "女警" },
    { char: "👮‍♂️", keys: ["police_man"], cn: "男警" },
    { char: "👷‍♀️", keys: ["construction_woman"], cn: "女工" },
    { char: "👷‍♂️", keys: ["construction_man"], cn: "男工" },
    { char: "🤴", keys: ["prince"], cn: "王子" },
    { char: "👸", keys: ["princess"], cn: "公主" },
    { char: "🧙‍♀️", keys: ["mage_woman"], cn: "女巫" },
    { char: "🧙‍♂️", keys: ["mage_man"], cn: "男巫 法师" },
    { char: "🧚‍♀️", keys: ["fairy_woman"], cn: "仙女" },
    { char: "🧛‍♀️", keys: ["vampire_woman"], cn: "女吸血鬼" },
    { char: "🧛‍♂️", keys: ["vampire_man"], cn: "男吸血鬼" },
    { char: "🧜‍♀️", keys: ["美人鱼"], cn: "美人鱼" },
    { char: "🧟‍♂️", keys: ["zombie"], cn: "僵尸" },
    { char: "🚶‍♀️", keys: ["walking_woman"], cn: "走路女" },
    { char: "🚶‍♂️", keys: ["walking_man"], cn: "走路男" },
    { char: "🏃‍♀️", keys: ["running_woman"], cn: "跑步女" },
    { char: "🏃‍♂️", keys: ["running_man"], cn: "跑步男" },
    { char: "💃", keys: ["dancer"], cn: "跳舞 女" },
    { char: "🕺", keys: ["man_dancing"], cn: "跳舞 男" },
    { char: "👯‍♀️", keys: ["dancing_women"], cn: "兔女郎 跳舞" },
    { char: "🧘‍♀️", keys: ["yoga_woman"], cn: "瑜伽女" },
    { char: "🧘‍♂️", keys: ["yoga_man"], cn: "瑜伽男" },
    { char: "🛌", keys: ["sleeping_bed"], cn: "睡觉 床" },
    { char: "🗣️", keys: ["speaking"], cn: "说话 喊" },
    { char: "🤷‍♀️", keys: ["shrug_woman"], cn: "耸肩女 不知道" },
    { char: "🤷‍♂️", keys: ["shrug_man"], cn: "耸肩男 不知道" },
    { char: "🤦‍♀️", keys: ["facepalm_woman"], cn: "捂脸女 无语" },
    { char: "🤦‍♂️", keys: ["facepalm_man"], cn: "捂脸男 无语" },

    // --- 🐻 动物与自然 (Animals & Nature) ---
    { char: "🐵", keys: ["monkey_face"], cn: "猴子头" },
    { char: "🐒", keys: ["monkey"], cn: "猴子" },
    { char: "🦍", keys: ["gorilla"], cn: "大猩猩" },
    { char: "🐶", keys: ["dog"], cn: "狗 汪" },
    { char: "🐕", keys: ["dog2"], cn: "狗" },
    { char: "🐩", keys: ["poodle"], cn: "贵宾犬" },
    { char: "🐺", keys: ["wolf"], cn: "狼" },
    { char: "🦊", keys: ["fox"], cn: "狐狸" },
    { char: "🐱", keys: ["cat"], cn: "猫 喵" },
    { char: "🐈", keys: ["cat2"], cn: "猫" },
    { char: "🦁", keys: ["lion"], cn: "狮子" },
    { char: "🐯", keys: ["tiger"], cn: "老虎" },
    { char: "🐆", keys: ["leopard"], cn: "豹子" },
    { char: "🐴", keys: ["horse"], cn: "马" },
    { char: "🦄", keys: ["unicorn"], cn: "独角兽" },
    { char: "🦓", keys: ["zebra"], cn: "斑马" },
    { char: "🦌", keys: ["deer"], cn: "鹿" },
    { char: "🐮", keys: ["cow"], cn: "牛头" },
    { char: "🐂", keys: ["ox"], cn: "公牛" },
    { char: "🐃", keys: ["water_buffalo"], cn: "水牛" },
    { char: "🐄", keys: ["cow2"], cn: "奶牛" },
    { char: "🐷", keys: ["pig"], cn: "猪头" },
    { char: "🐖", keys: ["pig2"], cn: "猪" },
    { char: "🐗", keys: ["boar"], cn: "野猪" },
    { char: "🐏", keys: ["ram"], cn: "公羊" },
    { char: "🐑", keys: ["sheep"], cn: "绵羊" },
    { char: "🐐", keys: ["goat"], cn: "山羊" },
    { char: "🐪", keys: ["camel"], cn: "骆驼" },
    { char: "🐫", keys: ["two_hump_camel"], cn: "双峰驼" },
    { char: "🦙", keys: ["llama"], cn: "羊驼 草泥马" },
    { char: "🦒", keys: ["giraffe"], cn: "长颈鹿" },
    { char: "🐘", keys: ["elephant"], cn: "大象" },
    { char: "🦏", keys: ["rhinoceros"], cn: "犀牛" },
    { char: "🦛", keys: ["hippo"], cn: "河马" },
    { char: "🐭", keys: ["mouse"], cn: "老鼠头" },
    { char: "🐁", keys: ["mouse2"], cn: "老鼠" },
    { char: "🐀", keys: ["rat"], cn: "大老鼠" },
    { char: "🐹", keys: ["hamster"], cn: "仓鼠" },
    { char: "🐰", keys: ["rabbit"], cn: "兔子头" },
    { char: "🐇", keys: ["rabbit2"], cn: "兔子" },
    { char: "🐿️", keys: ["chipmunk"], cn: "松鼠" },
    { char: "🦔", keys: ["hedgehog"], cn: "刺猬" },
    { char: "🦇", keys: ["bat"], cn: "蝙蝠" },
    { char: "🐻", keys: ["bear"], cn: "熊" },
    { char: "🐨", keys: ["koala"], cn: "考拉" },
    { char: "🐼", keys: ["panda"], cn: "熊猫" },
    { char: "🦘", keys: ["kangaroo"], cn: "袋鼠" },
    { char: "🐾", keys: ["paw_prints"], cn: "脚印 爪子" },
    { char: "🦃", keys: ["turkey"], cn: "火鸡" },
    { char: "🐔", keys: ["chicken"], cn: "鸡" },
    { char: "🐓", keys: ["rooster"], cn: "公鸡" },
    { char: "🐣", keys: ["hatching_chick"], cn: "孵化 小鸡" },
    { char: "🐤", keys: ["baby_chick"], cn: "小鸡" },
    { char: "🐥", keys: ["hatched_chick"], cn: "正面小鸡" },
    { char: "🐦", keys: ["bird"], cn: "鸟" },
    { char: "🐧", keys: ["penguin"], cn: "企鹅" },
    { char: "🕊️", keys: ["dove"], cn: "鸽子 和平" },
    { char: "🦅", keys: ["eagle"], cn: "老鹰" },
    { char: "🦆", keys: ["duck"], cn: "鸭子" },
    { char: "🦢", keys: ["swan"], cn: "天鹅" },
    { char: "🦉", keys: ["owl"], cn: "猫头鹰" },
    { char: "🦚", keys: ["peacock"], cn: "孔雀" },
    { char: "🦜", keys: ["parrot"], cn: "鹦鹉" },
    { char: "🐸", keys: ["frog"], cn: "青蛙" },
    { char: "🐊", keys: ["crocodile"], cn: "鳄鱼" },
    { char: "🐢", keys: ["turtle"], cn: "乌龟" },
    { char: "🦎", keys: ["lizard"], cn: "蜥蜴" },
    { char: "🐍", keys: ["snake"], cn: "蛇" },
    { char: "🐲", keys: ["dragon_face"], cn: "龙头" },
    { char: "🐉", keys: ["dragon"], cn: "龙" },
    { char: "🦕", keys: ["sauropod"], cn: "恐龙" },
    { char: "🦖", keys: ["t-rex"], cn: "霸王龙" },
    { char: "🐳", keys: ["whale"], cn: "鲸鱼" },
    { char: "🐬", keys: ["dolphin"], cn: "海豚" },
    { char: "🐟", keys: ["fish"], cn: "鱼" },
    { char: "🐠", keys: ["tropical_fish"], cn: "热带鱼" },
    { char: "🐡", keys: ["blowfish"], cn: "河豚" },
    { char: "🦈", keys: ["shark"], cn: "鲨鱼" },
    { char: "🐙", keys: ["octopus"], cn: "章鱼" },
    { char: "🐚", keys: ["shell"], cn: "贝壳" },
    { char: "🐌", keys: ["snail"], cn: "蜗牛" },
    { char: "🦋", keys: ["butterfly"], cn: "蝴蝶" },
    { char: "🐛", keys: ["bug"], cn: "毛毛虫" },
    { char: "🐜", keys: ["ant"], cn: "蚂蚁" },
    { char: "🐝", keys: ["bee"], cn: "蜜蜂" },
    { char: "🐞", keys: ["lady_beetle"], cn: "瓢虫" },
    { char: "🦗", keys: ["cricket"], cn: "蟋蟀" },
    { char: "🕷️", keys: ["spider"], cn: "蜘蛛" },
    { char: "🕸️", keys: ["spider_web"], cn: "蜘蛛网" },
    { char: "🦂", keys: ["scorpion"], cn: "蝎子" },
    { char: "🦟", keys: ["mosquito"], cn: "蚊子" },
    { char: "🦠", keys: ["microbe"], cn: "细菌 病毒" },
    { char: "💐", keys: ["bouquet"], cn: "花束" },
    { char: "🌸", keys: ["cherry_blossom"], cn: "樱花" },
    { char: "💮", keys: ["white_flower"], cn: "白花" },
    { char: "🌹", keys: ["rose"], cn: "玫瑰" },
    { char: "🥀", keys: ["wilted_flower"], cn: "凋谢花" },
    { char: "🌺", keys: ["hibiscus"], cn: "芙蓉花" },
    { char: "🌻", keys: ["sunflower"], cn: "向日葵" },
    { char: "🌼", keys: ["blossom"], cn: "开花" },
    { char: "🌷", keys: ["tulip"], cn: "郁金香" },
    { char: "🌱", keys: ["seedling"], cn: "幼苗 发芽" },
    { char: "🌲", keys: ["evergreen"], cn: "松树" },
    { char: "🌳", keys: ["tree"], cn: "树" },
    { char: "🌴", keys: ["palm_tree"], cn: "棕榈树" },
    { char: "🌵", keys: ["cactus"], cn: "仙人掌" },
    { char: "🌾", keys: ["ear_of_rice"], cn: "稻子" },
    { char: "🌿", keys: ["herb"], cn: "草药 叶子" },
    { char: "☘️", keys: ["shamrock"], cn: "三叶草" },
    { char: "🍀", keys: ["four_leaf_clover"], cn: "四叶草 幸运" },
    { char: "🍁", keys: ["maple_leaf"], cn: "枫叶" },
    { char: "🍂", keys: ["fallen_leaf"], cn: "落叶" },
    { char: "🍃", keys: ["leaves"], cn: "叶子 飘" },
    { char: "🍇", keys: ["grapes"], cn: "葡萄" },
    { char: "🍈", keys: ["melon"], cn: "哈密瓜" },
    { char: "🍉", keys: ["watermelon"], cn: "西瓜" },
    { char: "🍊", keys: ["tangerine"], cn: "橘子" },
    { char: "🍋", keys: ["lemon"], cn: "柠檬" },
    { char: "🍌", keys: ["banana"], cn: "香蕉" },
    { char: "🍍", keys: ["pineapple"], cn: "菠萝" },
    { char: "🥭", keys: ["mango"], cn: "芒果" },
    { char: "🍎", keys: ["apple"], cn: "红苹果" },
    { char: "🍏", keys: ["green_apple"], cn: "青苹果" },
    { char: "🍐", keys: ["pear"], cn: "梨" },
    { char: "🍑", keys: ["peach"], cn: "桃子 屁股" },
    { char: "🍒", keys: ["cherries"], cn: "樱桃" },
    { char: "🍓", keys: ["strawberry"], cn: "草莓" },
    { char: "🥝", keys: ["kiwi"], cn: "猕猴桃" },
    { char: "🍅", keys: ["tomato"], cn: "西红柿" },
    { char: "🥥", keys: ["coconut"], cn: "椰子" },
    { char: "🥑", keys: ["avocado"], cn: "牛油果" },
    { char: "🍆", keys: ["eggplant"], cn: "茄子" },
    { char: "🥔", keys: ["potato"], cn: "土豆" },
    { char: "🥕", keys: ["carrot"], cn: "胡萝卜" },
    { char: "🌽", keys: ["corn"], cn: "玉米" },
    { char: "🌶️", keys: ["chili"], cn: "辣椒" },
    { char: "🥒", keys: ["cucumber"], cn: "黄瓜" },
    { char: "🥬", keys: ["leafy_green"], cn: "青菜" },
    { char: "🥦", keys: ["broccoli"], cn: "西兰花" },
    { char: "🍄", keys: ["mushroom"], cn: "蘑菇" },
    { char: "🥜", keys: ["peanuts"], cn: "花生" },
    { char: "🌰", keys: ["chestnut"], cn: "栗子" },
    { char: "🍞", keys: ["bread"], cn: "面包" },
    { char: "🥐", keys: ["croissant"], cn: "牛角包" },
    { char: "🥖", keys: ["baguette"], cn: "法棍" },
    { char: "🥨", keys: ["pretzel"], cn: "椒盐卷饼" },
    { char: "🥯", keys: ["bagel"], cn: "贝果" },
    { char: "🥞", keys: ["pancakes"], cn: "煎饼" },
    { char: "🧀", keys: ["cheese"], cn: "芝士 奶酪" },
    { char: "🍖", keys: ["meat_on_bone"], cn: "带骨肉" },
    { char: "🍗", keys: ["poultry_leg"], cn: "鸡腿" },
    { char: "🥩", keys: ["cut_of_meat"], cn: "肉排 牛排" },
    { char: "🥓", keys: ["bacon"], cn: "培根" },
    { char: "🍔", keys: ["hamburger"], cn: "汉堡" },
    { char: "🍟", keys: ["fries"], cn: "薯条" },
    { char: "🍕", keys: ["pizza"], cn: "披萨" },
    { char: "🌭", keys: ["hotdog"], cn: "热狗" },
    { char: "🥪", keys: ["sandwich"], cn: "三明治" },
    { char: "🌮", keys: ["taco"], cn: "塔可" },
    { char: "🌯", keys: ["burrito"], cn: "卷饼" },
    { char: "🥙", keys: ["stuffed_flatbread"], cn: "夹饼" },
    { char: "🥚", keys: ["egg"], cn: "鸡蛋" },
    { char: "🍳", keys: ["fried_egg"], cn: "煎蛋" },
    { char: "🥘", keys: ["shallow_pan"], cn: "西班牙海鲜饭" },
    { char: "🍲", keys: ["stew"], cn: "炖菜 火锅" },
    { char: "🥣", keys: ["bowl_with_spoon"], cn: "碗勺 麦片" },
    { char: "🥗", keys: ["salad"], cn: "沙拉" },
    { char: "🍿", keys: ["popcorn"], cn: "爆米花" },
    { char: "🧂", keys: ["salt"], cn: "盐" },
    { char: "🥫", keys: ["canned_food"], cn: "罐头" },
    { char: "🍱", keys: ["bento"], cn: "便当" },
    { char: "🍙", keys: ["rice_ball"], cn: "饭团" },
    { char: "🍚", keys: ["rice"], cn: "米饭" },
    { char: "🍛", keys: ["curry"], cn: "咖喱" },
    { char: "🍜", keys: ["ramen"], cn: "拉面 面条" },
    { char: "🍝", keys: ["spaghetti"], cn: "意面" },
    { char: "🍠", keys: ["sweet_potato"], cn: "烤红薯" },
    { char: "🍢", keys: ["oden"], cn: "关东煮" },
    { char: "🍣", keys: ["sushi"], cn: "寿司" },
    { char: "🍤", keys: ["fried_shrimp"], cn: "炸虾" },
    { char: "🍥", keys: ["fish_cake"], cn: "鱼板" },
    { char: "🥮", keys: ["moon_cake"], cn: "月饼" },
    { char: "🍡", keys: ["dango"], cn: "团子" },
    { char: "🥟", keys: ["dumpling"], cn: "饺子" },
    { char: "🥠", keys: ["fortune_cookie"], cn: "幸运饼干" },
    { char: "🥡", keys: ["takeout"], cn: "外卖盒" },
    { char: "🦀", keys: ["crab"], cn: "螃蟹" },
    { char: "🦞", keys: ["lobster"], cn: "龙虾" },
    { char: "🦐", keys: ["shrimp"], cn: "虾" },
    { char: "🦑", keys: ["squid"], cn: "鱿鱼" },
    { char: "🦪", keys: ["oyster"], cn: "生蚝" },
    { char: "🍦", keys: ["icecream"], cn: "冰淇淋" },
    { char: "🍧", keys: ["shaved_ice"], cn: "刨冰" },
    { char: "🍨", keys: ["ice_cream"], cn: "冰淇淋球" },
    { char: "🍩", keys: ["doughnut"], cn: "甜甜圈" },
    { char: "🍪", keys: ["cookie"], cn: "曲奇 饼干" },
    { char: "🎂", keys: ["cake"], cn: "蛋糕 生日" },
    { char: "🍰", keys: ["shortcake"], cn: "切块蛋糕" },
    { char: "🧁", keys: ["cupcake"], cn: "纸杯蛋糕" },
    { char: "🥧", keys: ["pie"], cn: "派" },
    { char: "🍫", keys: ["chocolate"], cn: "巧克力" },
    { char: "🍬", keys: ["candy"], cn: "糖果" },
    { char: "🍭", keys: ["lollipop"], cn: "棒棒糖" },
    { char: "🍮", keys: ["custard"], cn: "布丁" },
    { char: "🍯", keys: ["honey"], cn: "蜂蜜" },
    { char: "🍼", keys: ["baby_bottle"], cn: "奶瓶" },
    { char: "🥛", keys: ["milk"], cn: "牛奶" },
    { char: "☕", keys: ["coffee"], cn: "咖啡" },
    { char: "🍵", keys: ["tea"], cn: "茶" },
    { char: "🍶", keys: ["sake"], cn: "清酒" },
    { char: "🍾", keys: ["champagne"], cn: "香槟" },
    { char: "🍷", keys: ["wine"], cn: "红酒" },
    { char: "🍸", keys: ["cocktail"], cn: "鸡尾酒" },
    { char: "🍹", keys: ["tropical_drink"], cn: "热带饮料" },
    { char: "🍺", keys: ["beer"], cn: "啤酒" },
    { char: "🍻", keys: ["beers"], cn: "干杯" },
    { char: "🥂", keys: ["clinking_glasses"], cn: "碰杯" },
    { char: "🥃", keys: ["tumbler"], cn: "威士忌" },
    { char: "🥤", keys: ["cup_with_straw"], cn: "饮料杯" },
    { char: "🧃", keys: ["beverage_box"], cn: "果汁盒" },
    { char: "🧉", keys: ["mate"], cn: "马黛茶" },
    { char: "🧊", keys: ["ice_cube"], cn: "冰块" },
    { char: "🥢", keys: ["chopsticks"], cn: "筷子" },
    { char: "🍽️", keys: ["plate_utensils"], cn: "餐具盘子" },
    { char: "🍴", keys: ["fork_knife"], cn: "刀叉" },
    { char: "🥄", keys: ["spoon"], cn: "勺子" },

    // --- ⚽ 活动与运动 (Activities) ---
    { char: "⚽", keys: ["soccer"], cn: "足球" },
    { char: "🏀", keys: ["basketball"], cn: "篮球" },
    { char: "🏈", keys: ["football"], cn: "橄榄球" },
    { char: "⚾", keys: ["baseball"], cn: "棒球" },
    { char: "🥎", keys: ["softball"], cn: "垒球" },
    { char: "🎾", keys: ["tennis"], cn: "网球" },
    { char: "🏐", keys: ["volleyball"], cn: "排球" },
    { char: "🏉", keys: ["rugby"], cn: "英式橄榄球" },
    { char: "🥏", keys: ["flying_disc"], cn: "飞盘" },
    { char: "🎱", keys: ["8ball"], cn: "台球 8号球" },
    { char: "🏓", keys: ["ping_pong"], cn: "乒乓球" },
    { char: "🏸", keys: ["badminton"], cn: "羽毛球" },
    { char: "🥅", keys: ["goal"], cn: "球门" },
    { char: "🏒", keys: ["ice_hockey"], cn: "冰球" },
    { char: "🏑", keys: ["field_hockey"], cn: "曲棍球" },
    { char: "🥍", keys: ["lacrosse"], cn: "长曲棍球" },
    { char: "🏏", keys: ["cricket_bat"], cn: "板球" },
    { char: "🥊", keys: ["boxing"], cn: "拳击手套" },
    { char: "🥋", keys: ["martial_arts"], cn: "武术服" },
    { char: "⛸️", keys: ["ice_skate"], cn: "溜冰鞋" },
    { char: "🎣", keys: ["fishing"], cn: "钓鱼" },
    { char: "🤿", keys: ["diving_mask"], cn: "潜水镜" },
    { char: "🎿", keys: ["ski"], cn: "滑雪板" },
    { char: "🛷", keys: ["sled"], cn: "雪橇" },
    { char: "🥌", keys: ["curling"], cn: "冰壶" },
    { char: "🎯", keys: ["dart"], cn: "飞镖 命中" },
    { char: "🎱", keys: ["pool"], cn: "台球" },
    { char: "🎮", keys: ["video_game"], cn: "游戏手柄" },
    { char: "🎰", keys: ["slot_machine"], cn: "老虎机" },
    { char: "🎲", keys: ["die"], cn: "色子 骰子" },
    { char: "🧩", keys: ["puzzle"], cn: "拼图" },
    { char: "🧸", keys: ["teddy"], cn: "泰迪熊" },
    { char: "♟️", keys: ["chess"], cn: "国际象棋" },
    { char: "🎭", keys: ["masks"], cn: "面具 戏剧" },
    { char: "🎨", keys: ["art"], cn: "调色板 艺术" },
    { char: "🧵", keys: ["thread"], cn: "线" },
    { char: "🧶", keys: ["yarn"], cn: "毛线" },
    { char: "🎼", keys: ["score"], cn: "乐谱" },
    { char: "🎤", keys: ["mic"], cn: "麦克风 KTV" },
    { char: "🎧", keys: ["headphones"], cn: "耳机" },
    { char: "🎷", keys: ["sax"], cn: "萨克斯" },
    { char: "🎸", keys: ["guitar"], cn: "吉他" },
    { char: "🎹", keys: ["piano"], cn: "钢琴" },
    { char: "🎺", keys: ["trumpet"], cn: "小号" },
    { char: "🎻", keys: ["violin"], cn: "小提琴" },
    { char: "🥁", keys: ["drum"], cn: "鼓" },
    { char: "🎬", keys: ["clapper"], cn: "场记板 电影" },
    { char: "🏹", keys: ["bow"], cn: "弓箭" },

    // --- ✈️ 旅行与地点 (Travel & Places) ---
    { char: "🚗", keys: ["car"], cn: "汽车" },
    { char: "🚕", keys: ["taxi"], cn: "出租车" },
    { char: "🚙", keys: ["suv"], cn: "SUV" },
    { char: "🚌", keys: ["bus"], cn: "公交车" },
    { char: "🚎", keys: ["trolleybus"], cn: "无轨电车" },
    { char: "🏎️", keys: ["race_car"], cn: "赛车" },
    { char: "🚓", keys: ["police_car"], cn: "警车" },
    { char: "🚑", keys: ["ambulance"], cn: "救护车" },
    { char: "🚒", keys: ["fire_engine"], cn: "消防车" },
    { char: "🚐", keys: ["minibus"], cn: "面包车" },
    { char: "🚚", keys: ["truck"], cn: "卡车" },
    { char: "🚛", keys: ["articulated_lorry"], cn: "大货车" },
    { char: "🚜", keys: ["tractor"], cn: "拖拉机" },
    { char: "🛴", keys: ["kick_scooter"], cn: "滑板车" },
    { char: "🚲", keys: ["bicycle"], cn: "自行车" },
    { char: "🛵", keys: ["scooter"], cn: "摩托车" },
    { char: "🏍️", keys: ["motorcycle"], cn: "机车" },
    { char: "🚨", keys: ["rotating_light"], cn: "警报灯" },
    { char: "🚔", keys: ["oncoming_police_car"], cn: "警车" },
    { char: "🚍", keys: ["oncoming_bus"], cn: "公交车" },
    { char: "🚘", keys: ["oncoming_automobile"], cn: "汽车" },
    { char: "🚖", keys: ["oncoming_taxi"], cn: "出租车" },
    { char: "🚡", keys: ["aerial_tramway"], cn: "缆车" },
    { char: "🚠", keys: ["mountain_cableway"], cn: "索道" },
    { char: "🚟", keys: ["suspension_railway"], cn: "悬挂铁路" },
    { char: "🚃", keys: ["railway_car"], cn: "有轨电车" },
    { char: "🚋", keys: ["tram"], cn: "电车" },
    { char: "🚞", keys: ["mountain_railway"], cn: "登山火车" },
    { char: "🚝", keys: ["monorail"], cn: "单轨" },
    { char: "🚄", keys: ["bullettrain_side"], cn: "高铁" },
    { char: "🚅", keys: ["bullettrain_front"], cn: "高铁头" },
    { char: "🚈", keys: ["light_rail"], cn: "轻轨" },
    { char: "🚂", keys: ["steam_locomotive"], cn: "蒸汽火车" },
    { char: "🚆", keys: ["train"], cn: "火车" },
    { char: "🚇", keys: ["metro"], cn: "地铁" },
    { char: "🚊", keys: ["tram"], cn: "有轨电车" },
    { char: "🚉", keys: ["station"], cn: "车站" },
    { char: "🚁", keys: ["helicopter"], cn: "直升机" },
    { char: "🛩️", keys: ["small_airplane"], cn: "小飞机" },
    { char: "✈️", keys: ["airplane"], cn: "飞机" },
    { char: "🛫", keys: ["flight_departure"], cn: "起飞" },
    { char: "🛬", keys: ["flight_arrival"], cn: "降落" },
    { char: "🚀", keys: ["rocket"], cn: "火箭 发射" },
    { char: "🛸", keys: ["flying_saucer"], cn: "UFO 飞碟" },
    { char: "🛰️", keys: ["satellite"], cn: "卫星" },
    { char: "⛵", keys: ["sailboat"], cn: "帆船" },
    { char: "🚤", keys: ["speedboat"], cn: "快艇" },
    { char: "🛥️", keys: ["motor_boat"], cn: "摩托艇" },
    { char: "🛳️", keys: ["passenger_ship"], cn: "客轮" },
    { char: "⛴️", keys: ["ferry"], cn: "渡轮" },
    { char: "🚢", keys: ["ship"], cn: "船" },
    { char: "⚓", keys: ["anchor"], cn: "锚" },
    { char: "⛽", keys: ["fuelpump"], cn: "加油站" },
    { char: "🚧", keys: ["construction"], cn: "施工" },
    { char: "🚦", keys: ["traffic_light"], cn: "红绿灯" },
    { char: "🚏", keys: ["busstop"], cn: "公交站" },
    { char: "🗺️", keys: ["map"], cn: "地图" },
    { char: "🗿", keys: ["moyai"], cn: "石像 复活节" },
    { char: "🗽", keys: ["statue"], cn: "自由女神" },
    { char: "🗼", keys: ["tokyo_tower"], cn: "东京塔" },
    { char: "🏰", keys: ["castle"], cn: "城堡" },
    { char: "🏯", keys: ["japanese_castle"], cn: "日本城堡" },
    { char: "🏟️", keys: ["stadium"], cn: "体育场" },
    { char: "🎡", keys: ["ferris_wheel"], cn: "摩天轮" },
    { char: "🎢", keys: ["roller_coaster"], cn: "过山车" },
    { char: "🎠", keys: ["carousel"], cn: "旋转木马" },
    { char: "⛲", keys: ["fountain"], cn: "喷泉" },
    { char: "⛱️", keys: ["parasol_on_ground"], cn: "沙滩伞" },
    { char: "🏖️", keys: ["beach"], cn: "沙滩" },
    { char: "🏝️", keys: ["island"], cn: "岛屿" },
    { char: "🏜️", keys: ["desert"], cn: "沙漠" },
    { char: "🌋", keys: ["volcano"], cn: "火山" },
    { char: "⛰️", keys: ["mountain"], cn: "山" },
    { char: "🏔️", keys: ["snow_mountain"], cn: "雪山" },
    { char: "🗻", keys: ["fuji"], cn: "富士山" },
    { char: "🏕️", keys: ["camping"], cn: "露营" },
    { char: "⛺", keys: ["tent"], cn: "帐篷" },
    { char: "🏠", keys: ["house"], cn: "房子" },
    { char: "🏡", keys: ["house_with_garden"], cn: "花园房" },
    { char: "🏘️", keys: ["houses"], cn: "住宅区" },
    { char: "🏚️", keys: ["derelict_house"], cn: "废墟" },
    { char: "🏢", keys: ["office"], cn: "办公楼" },
    { char: "🏬", keys: ["department_store"], cn: "百货商店" },
    { char: "🏭", keys: ["factory"], cn: "工厂" },
    { char: "🏯", keys: ["japanese_castle"], cn: "城堡" },
    { char: "🏰", keys: ["castle"], cn: "城堡" },
    { char: "💒", keys: ["wedding"], cn: "婚礼教堂" },
    { char: "🗼", keys: ["tokyo_tower"], cn: "塔" },
    { char: "🗽", keys: ["statue_of_liberty"], cn: "自由女神" },
    { char: "⛪", keys: ["church"], cn: "教堂" },
    { char: "🕌", keys: ["mosque"], cn: "清真寺" },
    { char: "🕍", keys: ["synagogue"], cn: "犹太教堂" },
    { char: "⛩️", keys: ["shinto_shrine"], cn: "神社" },
    { char: "🕋", keys: ["kaaba"], cn: "克尔白" },
    { char: "⛲", keys: ["fountain"], cn: "喷泉" },
    { char: "⛺", keys: ["tent"], cn: "帐篷" },
    { char: "🌁", keys: ["foggy"], cn: "雾" },
    { char: "🌃", keys: ["night_with_stars"], cn: "夜景" },
    { char: "🌄", keys: ["sunrise_over_mountains"], cn: "日出" },
    { char: "🌅", keys: ["sunrise"], cn: "日出" },
    { char: "🌆", keys: ["city_sunset"], cn: "城市日落" },
    { char: "🌇", keys: ["sunset"], cn: "日落" },
    { char: "🌉", keys: ["bridge"], cn: "桥夜景" },
    { char: "🌌", keys: ["milky_way"], cn: "银河" },
    { char: "🎠", keys: ["carousel_horse"], cn: "旋转木马" },
    { char: "🎡", keys: ["ferris_wheel"], cn: "摩天轮" },
    { char: "🎢", keys: ["roller_coaster"], cn: "过山车" },
    { char: "💈", keys: ["barber"], cn: "理发店" },
    { char: "🎪", keys: ["circus"], cn: "马戏团" },
    { char: "🚂", keys: ["steam_locomotive"], cn: "火车" },
    { char: "🚃", keys: ["railway_car"], cn: "电车" },
    { char: "🚄", keys: ["bullettrain_side"], cn: "高铁" },
    { char: "🚅", keys: ["bullettrain_front"], cn: "高铁" },
    { char: "🚆", keys: ["train2"], cn: "火车" },
    { char: "🚇", keys: ["metro"], cn: "地铁" },
    { char: "🚈", keys: ["light_rail"], cn: "轻轨" },
    { char: "🚉", keys: ["station"], cn: "车站" },
    { char: "🚊", keys: ["tram"], cn: "电车" },
    { char: "🚝", keys: ["monorail"], cn: "单轨" },
    { char: "🚞", keys: ["mountain_railway"], cn: "山地火车" },
    { char: "🚋", keys: ["tram"], cn: "电车" },
    { char: "🚌", keys: ["bus"], cn: "巴士" },
    { char: "🚍", keys: ["oncoming_bus"], cn: "巴士" },
    { char: "🚎", keys: ["trolleybus"], cn: "电车" },
    { char: "🚐", keys: ["minibus"], cn: "小巴" },
    { char: "🚑", keys: ["ambulance"], cn: "救护车" },
    { char: "🚒", keys: ["fire_engine"], cn: "消防车" },
    { char: "🚓", keys: ["police_car"], cn: "警车" },
    { char: "🚔", keys: ["oncoming_police_car"], cn: "警车" },
    { char: "🚕", keys: ["taxi"], cn: "出租车" },
    { char: "🚖", keys: ["oncoming_taxi"], cn: "出租车" },
    { char: "🚗", keys: ["car", "red_car"], cn: "汽车" },
    { char: "🚘", keys: ["oncoming_automobile"], cn: "汽车" },
    { char: "🚙", keys: ["suv"], cn: "SUV" },
    { char: "🚚", keys: ["truck"], cn: "卡车" },
    { char: "🚛", keys: ["articulated_lorry"], cn: "大卡车" },
    { char: "🚜", keys: ["tractor"], cn: "拖拉机" },
    { char: "🚲", keys: ["bike"], cn: "自行车" },
    { char: "🛴", keys: ["scooter"], cn: "滑板车" },
    { char: "🛵", keys: ["motor_scooter"], cn: "电动车" },
    { char: "🏍️", keys: ["motorcycle"], cn: "摩托车" },
    { char: "🚏", keys: ["busstop"], cn: "车站牌" },
    { char: "🛤️", keys: ["railway_track"], cn: "铁轨" },
    { char: "⛽", keys: ["fuelpump"], cn: "加油站" },
    { char: "🚨", keys: ["rotating_light"], cn: "警灯" },
    { char: "🚥", keys: ["traffic_light"], cn: "红绿灯" },
    { char: "🚦", keys: ["vertical_traffic_light"], cn: "红绿灯" },
    { char: "🚧", keys: ["construction"], cn: "施工" },
    { char: "⚓", keys: ["anchor"], cn: "锚" },
    { char: "⛵", keys: ["sailboat"], cn: "帆船" },
    { char: "🚣‍♀️", keys: ["rowing_woman"], cn: "划船女" },
    { char: "🚣‍♂️", keys: ["rowing_man"], cn: "划船男" },
    { char: "🚤", keys: ["speedboat"], cn: "快艇" },
    { char: "🛳️", keys: ["passenger_ship"], cn: "客轮" },
    { char: "⛴️", keys: ["ferry"], cn: "渡轮" },
    { char: "🛥️", keys: ["motor_boat"], cn: "摩托艇" },
    { char: "🚢", keys: ["ship"], cn: "船" },
    { char: "✈️", keys: ["airplane"], cn: "飞机" },
    { char: "🛩️", keys: ["small_airplane"], cn: "小飞机" },
    { char: "🛫", keys: ["flight_departure"], cn: "起飞" },
    { char: "🛬", keys: ["flight_arrival"], cn: "降落" },
    { char: "💺", keys: ["seat"], cn: "座位" },
    { char: "🚁", keys: ["helicopter"], cn: "直升机" },
    { char: "🚟", keys: ["suspension_railway"], cn: "悬挂铁路" },
    { char: "🚠", keys: ["mountain_cableway"], cn: "缆车" },
    { char: "🚡", keys: ["aerial_tramway"], cn: "航拍" },
    { char: "🚀", keys: ["rocket"], cn: "火箭" },
    { char: "🛸", keys: ["flying_saucer"], cn: "UFO" },
    { char: "🛰️", keys: ["satellite"], cn: "卫星" },

    // --- 💡 物体 (Objects) ---
    { char: "⌚", keys: ["watch"], cn: "手表" },
    { char: "📱", keys: ["iphone"], cn: "手机" },
    { char: "📲", keys: ["calling"], cn: "来电" },
    { char: "💻", keys: ["computer"], cn: "电脑 笔记本" },
    { char: "⌨️", keys: ["keyboard"], cn: "键盘" },
    { char: "🖥️", keys: ["desktop"], cn: "台式机" },
    { char: "🖨️", keys: ["printer"], cn: "打印机" },
    { char: "🖱️", keys: ["mouse_three_button"], cn: "鼠标" },
    { char: "🖲️", keys: ["trackball"], cn: "轨迹球" },
    { char: "🕹️", keys: ["joystick"], cn: "摇杆" },
    { char: "🗜️", keys: ["clamp"], cn: "夹子" },
    { char: "💽", keys: ["minidisc"], cn: "MD" },
    { char: "💾", keys: ["floppy_disk"], cn: "软盘 Save" },
    { char: "💿", keys: ["cd"], cn: "光盘" },
    { char: "📀", keys: ["dvd"], cn: "DVD" },
    { char: "📼", keys: ["vhs"], cn: "录像带" },
    { char: "📷", keys: ["camera"], cn: "相机 拍照" },
    { char: "📸", keys: ["camera_flash"], cn: "闪光灯拍照" },
    { char: "📹", keys: ["video_camera"], cn: "摄像机" },
    { char: "🎥", keys: ["movie_camera"], cn: "电影摄像机" },
    { char: "📽️", keys: ["projector"], cn: "投影仪" },
    { char: "🎞️", keys: ["film_strip"], cn: "胶片" },
    { char: "📞", keys: ["telephone_receiver"], cn: "电话听筒" },
    { char: "☎️", keys: ["phone"], cn: "电话" },
    { char: "📟", keys: ["pager"], cn: "寻呼机" },
    { char: "📠", keys: ["fax"], cn: "传真" },
    { char: "📺", keys: ["tv"], cn: "电视" },
    { char: "📻", keys: ["radio"], cn: "收音机" },
    { char: "🎙️", keys: ["studio_microphone"], cn: "麦克风" },
    { char: "🎚️", keys: ["level_slider"], cn: "推子" },
    { char: "🎛️", keys: ["control_knobs"], cn: "旋钮" },
    { char: "🧭", keys: ["compass"], cn: "指南针" },
    { char: "⏱️", keys: ["stopwatch"], cn: "秒表" },
    { char: "⏲️", keys: ["timer_clock"], cn: "定时器" },
    { char: "⏰", keys: ["alarm_clock"], cn: "闹钟" },
    { char: "🕰️", keys: ["mantelpiece_clock"], cn: "座钟" },
    { char: "⌛", keys: ["hourglass"], cn: "沙漏" },
    { char: "⏳", keys: ["hourglass_flowing_sand"], cn: "沙漏计时" },
    { char: "📡", keys: ["satellite_antenna"], cn: "天线" },
    { char: "🔋", keys: ["battery"], cn: "电池" },
    { char: "🔌", keys: ["electric_plug"], cn: "插头" },
    { char: "💡", keys: ["bulb"], cn: "灯泡 想法" },
    { char: "🔦", keys: ["flashlight"], cn: "手电筒" },
    { char: "🕯️", keys: ["candle"], cn: "蜡烛" },
    { char: "🗑️", keys: ["wastebasket"], cn: "垃圾桶" },
    { char: "🛢️", keys: ["oil_drum"], cn: "油桶" },
    { char: "💸", keys: ["money_with_wings"], cn: "飞钱 花钱" },
    { char: "💵", keys: ["dollar"], cn: "美元 钞票" },
    { char: "💴", keys: ["yen"], cn: "日元" },
    { char: "💶", keys: ["euro"], cn: "欧元" },
    { char: "💷", keys: ["pound"], cn: "英镑" },
    { char: "💰", keys: ["moneybag"], cn: "钱袋" },
    { char: "💳", keys: ["credit_card"], cn: "信用卡" },
    { char: "💎", keys: ["gem"], cn: "钻石" },
    { char: "⚖️", keys: ["balance_scale"], cn: "天平" },
    { char: "🧰", keys: ["toolbox"], cn: "工具箱" },
    { char: "🔧", keys: ["wrench"], cn: "扳手" },
    { char: "🔨", keys: ["hammer"], cn: "锤子" },
    { char: "⚒️", keys: ["hammer_and_pick"], cn: "锤子镐" },
    { char: "🛠️", keys: ["hammer_and_wrench"], cn: "锤子扳手" },
    { char: "⛏️", keys: ["pick"], cn: "镐" },
    { char: "🔩", keys: ["nut_and_bolt"], cn: "螺母螺栓" },
    { char: "⚙️", keys: ["gear"], cn: "齿轮 设置" },
    { char: "🧱", keys: ["brick"], cn: "砖头" },
    { char: "⛓️", keys: ["chains"], cn: "铁链" },
    { char: "🧲", keys: ["magnet"], cn: "磁铁" },
    { char: "🔫", keys: ["gun"], cn: "手枪 水枪" },
    { char: "💣", keys: ["bomb"], cn: "炸弹" },
    { char: "🧨", keys: ["firecracker"], cn: "鞭炮" },
    { char: "🪓", keys: ["axe"], cn: "斧头" },
    { char: "🔪", keys: ["knife"], cn: "刀" },
    { char: "🗡️", keys: ["dagger"], cn: "匕首" },
    { char: "⚔️", keys: ["crossed_swords"], cn: "双剑" },
    { char: "🛡️", keys: ["shield"], cn: "盾牌" },
    { char: "🚬", keys: ["smoking"], cn: "抽烟" },
    { char: "⚰️", keys: ["coffin"], cn: "棺材" },
    { char: "⚱️", keys: ["funeral_urn"], cn: "骨灰盒" },
    { char: "🏺", keys: ["amphora"], cn: "陶罐" },
    { char: "🔮", keys: ["crystal_ball"], cn: "水晶球" },
    { char: "📿", keys: ["prayer_beads"], cn: "佛珠" },
    { char: "🧿", keys: ["nazar_amulet"], cn: "恶魔之眼" },
    { char: "💈", keys: ["barber"], cn: "理发店" },
    { char: "⚗️", keys: ["alembic"], cn: "蒸馏器" },
    { char: "🔭", keys: ["telescope"], cn: "望远镜" },
    { char: "🔬", keys: ["microscope"], cn: "显微镜" },
    { char: "🕳️", keys: ["hole"], cn: "洞" },
    { char: "💊", keys: ["pill"], cn: "药丸" },
    { char: "💉", keys: ["syringe"], cn: "注射器 打针" },
    { char: "🧬", keys: ["dna"], cn: "DNA" },
    { char: "🦠", keys: ["microbe"], cn: "细菌" },
    { char: "🧫", keys: ["petri_dish"], cn: "培养皿" },
    { char: "🧪", keys: ["test_tube"], cn: "试管" },
    { char: "🌡️", keys: ["thermometer"], cn: "温度计" },
    { char: "🧹", keys: ["broom"], cn: "扫把" },
    { char: "🧺", keys: ["basket"], cn: "篮子" },
    { char: "🧻", keys: ["toilet_paper"], cn: "卫生纸" },
    { char: "🧼", keys: ["soap"], cn: "肥皂" },
    { char: "🧽", keys: ["sponge"], cn: "海绵" },
    { char: "🧯", keys: ["fire_extinguisher"], cn: "灭火器" },
    { char: "🛒", keys: ["shopping_cart"], cn: "购物车" },
    { char: "🔑", keys: ["key"], cn: "钥匙" },
    { char: "🗝️", keys: ["old_key"], cn: "老钥匙" },
    { char: "🚪", keys: ["door"], cn: "门" },
    { char: "🧸", keys: ["teddy"], cn: "泰迪熊" },
    { char: "🖼️", keys: ["framed_picture"], cn: "画框" },
    { char: "🧵", keys: ["thread"], cn: "线" },
    { char: "🧶", keys: ["yarn"], cn: "毛线" },
    { char: "🛍️", keys: ["shopping_bags"], cn: "购物袋" },
    { char: "🧥", keys: ["coat"], cn: "外套" },
    { char: "🥼", keys: ["lab_coat"], cn: "白大褂" },
    { char: "👚", keys: ["shirt"], cn: "女衬衫" },
    { char: "👕", keys: ["tshirt"], cn: "T恤" },
    { char: "👖", keys: ["jeans"], cn: "牛仔裤" },
    { char: "👔", keys: ["necktie"], cn: "领带" },
    { char: "👗", keys: ["dress"], cn: "裙子" },
    { char: "👙", keys: ["bikini"], cn: "比基尼" },
    { char: "👘", keys: ["kimono"], cn: "和服" },
    { char: "💄", keys: ["lipstick"], cn: "口红" },
    { char: "💍", keys: ["ring"], cn: "戒指" },
    { char: "💎", keys: ["gem"], cn: "钻石" },
    { char: "⚽", keys: ["soccer"], cn: "足球" },
    { char: "🏀", keys: ["basketball"], cn: "篮球" },
    { char: "🏈", keys: ["football"], cn: "橄榄球" },
    { char: "⚾", keys: ["baseball"], cn: "棒球" },
    { char: "🥎", keys: ["softball"], cn: "垒球" },
    { char: "🎾", keys: ["tennis"], cn: "网球" },
    { char: "🏐", keys: ["volleyball"], cn: "排球" },
    { char: "🏉", keys: ["rugby"], cn: "英式橄榄球" },
    { char: "🥏", keys: ["flying_disc"], cn: "飞盘" },
    { char: "🎱", keys: ["8ball"], cn: "台球" },
    { char: "🏓", keys: ["ping_pong"], cn: "乒乓球" },
    { char: "🏸", keys: ["badminton"], cn: "羽毛球" },
    { char: "🥅", keys: ["goal"], cn: "球门" },
    { char: "🏒", keys: ["ice_hockey"], cn: "冰球" },
    { char: "🏑", keys: ["field_hockey"], cn: "曲棍球" },
    { char: "🥍", keys: ["lacrosse"], cn: "长曲棍球" },
    { char: "🏏", keys: ["cricket_bat"], cn: "板球" },
    { char: "🥊", keys: ["boxing"], cn: "拳击" },
    { char: "🥋", keys: ["martial_arts"], cn: "武术" },
    { char: "⛸️", keys: ["ice_skate"], cn: "溜冰" },
    { char: "🎣", keys: ["fishing"], cn: "钓鱼" },
    { char: "🤿", keys: ["diving_mask"], cn: "潜水" },
    { char: "🎿", keys: ["ski"], cn: "滑雪" },
    { char: "🛷", keys: ["sled"], cn: "雪橇" },
    { char: "🥌", keys: ["curling"], cn: "冰壶" },
    { char: "🎯", keys: ["dart"], cn: "飞镖" },
    { char: "🎱", keys: ["pool"], cn: "台球" },
    { char: "🎮", keys: ["video_game"], cn: "游戏手柄" },
    { char: "🎰", keys: ["slot_machine"], cn: "老虎机" },
    { char: "🎲", keys: ["die"], cn: "色子" },
    { char: "🧩", keys: ["puzzle"], cn: "拼图" },
    { char: "♟️", keys: ["chess"], cn: "国际象棋" },
    { char: "🎭", keys: ["masks"], cn: "面具" },
    { char: "🎨", keys: ["art"], cn: "调色板" },
    { char: "🎼", keys: ["score"], cn: "乐谱" },
    { char: "🎤", keys: ["mic"], cn: "麦克风" },
    { char: "🎧", keys: ["headphones"], cn: "耳机" },
    { char: "🎷", keys: ["sax"], cn: "萨克斯" },
    { char: "🎸", keys: ["guitar"], cn: "吉他" },
    { char: "🎹", keys: ["piano"], cn: "钢琴" },
    { char: "🎺", keys: ["trumpet"], cn: "小号" },
    { char: "🎻", keys: ["violin"], cn: "小提琴" },
    { char: "🥁", keys: ["drum"], cn: "鼓" },
    { char: "🎬", keys: ["clapper"], cn: "场记板" },
    { char: "🏹", keys: ["bow"], cn: "弓箭" },
// --- ☁️ 天气与天体 (Weather & Celestial) ---
    { char: "🌒", keys: ["waxing_crescent_moon"], cn: "蛾眉月 waxing crescent moon" },
    { char: "🌓", keys: ["first_quarter_moon"], cn: "上弦月 first quarter moon" },
    { char: "🌔", keys: ["moon", "waxing_gibbous_moon"], cn: "盈凸月 月亮 moon waxing gibbous" },
    { char: "🌕", keys: ["full_moon"], cn: "满月 full moon" },
    { char: "🌖", keys: ["waning_gibbous_moon"], cn: "亏凸月 waning gibbous moon" },
    { char: "🌗", keys: ["last_quarter_moon"], cn: "下弦月 last quarter moon" },
    { char: "🌘", keys: ["waning_crescent_moon"], cn: "残月 waning crescent moon" },
    { char: "🌙", keys: ["crescent_moon"], cn: "弯月 月牙 crescent moon" },
    { char: "🌚", keys: ["new_moon_with_face"], cn: "黑月脸 new moon face" },
    { char: "🌛", keys: ["first_quarter_moon_with_face"], cn: "上弦月脸 first quarter moon face" },
    { char: "🌜", keys: ["last_quarter_moon_with_face"], cn: "下弦月脸 last quarter moon face" },
    { char: "🌝", keys: ["full_moon_with_face"], cn: "满月脸 full moon face" },
    { char: "☀️", keys: ["sunny"], cn: "晴天 太阳 sunny sun" },
    { char: "🌞", keys: ["sun_with_face"], cn: "太阳脸 sun face" },
    { char: "⭐", keys: ["star"], cn: "星星 star" },
    { char: "🌟", keys: ["star2"], cn: "闪烁星星 star2 glowing" },
    { char: "🌠", keys: ["stars"], cn: "流星 shooting star stars" },
    { char: "🌌", keys: ["milky_way"], cn: "银河 milky way galaxy" },
    { char: "🪐", keys: ["ringed_planet"], cn: "行星 土星 ringed planet saturn" },
    { char: "☁️", keys: ["cloud"], cn: "云 cloud" },
    { char: "⛅", keys: ["partly_sunny"], cn: "多云 partly sunny cloud" },
    { char: "⛈️", keys: ["cloud_with_lightning_and_rain"], cn: "雷雨 storm lightning rain" },
    { char: "🌤️", keys: ["sun_behind_small_cloud"], cn: "晴转多云 sun small cloud" },
    { char: "🌥️", keys: ["sun_behind_large_cloud"], cn: "多云 sun large cloud" },
    { char: "🌦️", keys: ["sun_behind_rain_cloud"], cn: "太阳雨 sun rain cloud" },
    { char: "🌧️", keys: ["cloud_with_rain"], cn: "下雨 rain" },
    { char: "🌨️", keys: ["cloud_with_snow"], cn: "下雪 snow" },
    { char: "🌩️", keys: ["cloud_with_lightning"], cn: "闪电 lightning" },
    { char: "🌡️", keys: ["thermometer"], cn: "温度计 热 thermometer temp" },
    // --- 🔣 符号与标志 (Symbols) ---
    { char: "❤️", keys: ["<3", "heart"], cn: "爱心 红心" },
    { char: "🧡", keys: ["orange_heart"], cn: "橙心" },
    { char: "💛", keys: ["yellow_heart"], cn: "黄心" },
    { char: "💚", keys: ["green_heart"], cn: "绿心" },
    { char: "💙", keys: ["blue_heart"], cn: "蓝心" },
    { char: "💜", keys: ["purple_heart"], cn: "紫心" },
    { char: "🖤", keys: ["black_heart"], cn: "黑心" },
    { char: "🤍", keys: ["white_heart"], cn: "白心" },
    { char: "🤎", keys: ["brown_heart"], cn: "棕心" },
    { char: "💔", keys: ["</3", "broken"], cn: "心碎" },
    { char: "💕", keys: ["two_hearts"], cn: "两颗心" },
    { char: "💞", keys: ["revolving"], cn: "旋转心" },
    { char: "💓", keys: ["beating"], cn: "跳动心" },
    { char: "💗", keys: ["growing"], cn: "心跳" },
    { char: "💖", keys: ["sparkling"], cn: "闪亮心" },
    { char: "💘", keys: ["cupid"], cn: "丘比特" },
    { char: "💝", keys: ["gift"], cn: "礼物心" },
    { char: "💟", keys: ["decoration"], cn: "装饰心" },
    { char: "☮️", keys: ["peace"], cn: "和平" },
    { char: "✝️", keys: ["cross"], cn: "十字架" },
    { char: "☪️", keys: ["star_and_crescent"], cn: "星月" },
    { char: "🕉️", keys: ["om"], cn: "唵" },
    { char: "☸️", keys: ["wheel_of_dharma"], cn: "法轮" },
    { char: "✡️", keys: ["star_of_david"], cn: "大卫之星" },
    { char: "🔯", keys: ["six_pointed_star"], cn: "六角星" },
    { char: "🕎", keys: ["menorah"], cn: "烛台" },
    { char: "☯️", keys: ["yin_yang"], cn: "阴阳" },
    { char: "☦️", keys: ["orthodox_cross"], cn: "东正教" },
    { char: "🛐", keys: ["place_of_worship"], cn: "宗教场所" },
    { char: "⛎", keys: ["ophiuchus"], cn: "蛇夫座" },
    { char: "♈", keys: ["aries"], cn: "白羊座" },
    { char: "♉", keys: ["taurus"], cn: "金牛座" },
    { char: "♊", keys: ["gemini"], cn: "双子座" },
    { char: "♋", keys: ["cancer"], cn: "巨蟹座" },
    { char: "♌", keys: ["leo"], cn: "狮子座" },
    { char: "♍", keys: ["virgo"], cn: "处女座" },
    { char: "♎", keys: ["libra"], cn: "天秤座" },
    { char: "♏", keys: ["scorpio"], cn: "天蝎座" },
    { char: "♐", keys: ["sagittarius"], cn: "射手座" },
    { char: "♑", keys: ["capricorn"], cn: "摩羯座" },
    { char: "♒", keys: ["aquarius"], cn: "水瓶座" },
    { char: "♓", keys: ["pisces"], cn: "双鱼座" },
    { char: "🆔", keys: ["id"], cn: "ID" },
    { char: "⚛️", keys: ["atom"], cn: "原子" },
    { char: "🉑", keys: ["accept"], cn: "可" },
    { char: "☢️", keys: ["radioactive"], cn: "辐射" },
    { char: "☣️", keys: ["biohazard"], cn: "生化" },
    { char: "📴", keys: ["mobile_phone_off"], cn: "关机" },
    { char: "📳", keys: ["vibration_mode"], cn: "震动" },
    { char: "🈶", keys: ["have"], cn: "有" },
    { char: "🈚", keys: ["free"], cn: "无 免费" },
    { char: "🈸", keys: ["application"], cn: "申" },
    { char: "🈺", keys: ["open"], cn: "营" },
    { char: "🈷️", keys: ["moon"], cn: "月" },
    { char: "✴️", keys: ["eight_pointed_star"], cn: "八角星" },
    { char: "🆚", keys: ["vs"], cn: "VS 对决" },
    { char: "🉑", keys: ["accept"], cn: "可" },
    { char: "💮", keys: ["white_flower"], cn: "白花" },
    { char: "🉐", keys: ["advantage"], cn: "得" },
    { char: "㊙️", keys: ["secret"], cn: "秘" },
    { char: "㊗️", keys: ["congratulations"], cn: "祝" },
    { char: "🈴", keys: ["grade"], cn: "合" },
    { char: "🈵", keys: ["full"], cn: "满" },
    { char: "🈹", keys: ["discount"], cn: "割 折扣" },
    { char: "🈲", keys: ["forbidden"], cn: "禁" },
    { char: "🅰️", keys: ["a"], cn: "A型" },
    { char: "🅱️", keys: ["b"], cn: "B型" },
    { char: "🆎", keys: ["ab"], cn: "AB型" },
    { char: "🆑", keys: ["cl"], cn: "CL 清除" },
    { char: "🅾️", keys: ["o"], cn: "O型" },
    { char: "🆘", keys: ["sos"], cn: "SOS 求救" },
    { char: "🛑", keys: ["stop"], cn: "停止" },
    { char: "⛔", keys: ["no_entry"], cn: "禁止驶入" },
    { char: "📛", keys: ["name_badge"], cn: "名牌" },
    { char: "🚫", keys: ["no"], cn: "禁止" },
    { char: "❌", keys: ["cross"], cn: "叉 错" },
    { char: "⭕", keys: ["circle"], cn: "圈 对" },
    { char: "💢", keys: ["anger"], cn: "怒" },
    { char: "♨️", keys: ["hotsprings"], cn: "温泉" },
    { char: "🚷", keys: ["no_pedestrians"], cn: "禁止行人" },
    { char: "🚯", keys: ["no_littering"], cn: "禁止乱扔" },
    { char: "🚳", keys: ["no_bicycles"], cn: "禁止自行车" },
    { char: "🚱", keys: ["non_potable_water"], cn: "非饮用水" },
    { char: "🔞", keys: ["under18"], cn: "18禁" },
    { char: "📵", keys: ["no_phones"], cn: "禁止手机" },
    { char: "🚭", keys: ["no_smoking"], cn: "禁止吸烟" },
    { char: "❗️", keys: ["exclamation"], cn: "感叹号" },
    { char: "❕", keys: ["grey_exclamation"], cn: "白色感叹号" },
    { char: "❓", keys: ["question"], cn: "问号" },
    { char: "❔", keys: ["grey_question"], cn: "白色问号" },
    { char: "‼️", keys: ["bangbang"], cn: "双感叹号" },
    { char: "⁉️", keys: ["interrobang"], cn: "问叹号" },
    { char: "🔅", keys: ["low_brightness"], cn: "低亮度" },
    { char: "🔆", keys: ["high_brightness"], cn: "高亮度" },
    { char: "🔱", keys: ["trident"], cn: "三叉戟" },
    { char: "⚜️", keys: ["fleur_de_lis"], cn: "鸢尾花" },
    { char: "〽️", keys: ["part_alternation"], cn: "标记" },
    { char: "⚠️", keys: ["warning"], cn: "警告" },
    { char: "🚸", keys: ["children_crossing"], cn: "儿童过街" },
    { char: "🔰", keys: ["beginner"], cn: "新手" },
    { char: "♻️", keys: ["recycle"], cn: "循环" },
    { char: "🈯", keys: ["pointing_finger"], cn: "指" },
    { char: "💹", keys: ["chart"], cn: "图表" },
    { char: "❇️", keys: ["sparkle"], cn: "闪烁" },
    { char: "✳️", keys: ["eight_spoked_asterisk"], cn: "八角星" },
    { char: "❎", keys: ["negative"], cn: "叉" },
    { char: "✅", keys: ["check"], cn: "勾 对" },
    { char: "💠", keys: ["diamond"], cn: "菱形" },
    { char: "🌀", keys: ["cyclone"], cn: "旋风" },
    { char: "➿", keys: ["loop"], cn: "双环" },
    { char: "🌐", keys: ["globe"], cn: "全球" },
    { char: "Ⓜ️", keys: ["m"], cn: "地铁 M" },
    { char: "🏧", keys: ["atm"], cn: "ATM" },
    { char: "🈂️", keys: ["sa"], cn: "萨" },
    { char: "🛂", keys: ["passport"], cn: "护照" },
    { char: "🛃", keys: ["customs"], cn: "海关" },
    { char: "🛄", keys: ["baggage"], cn: "行李" },
    { char: "🛅", keys: ["left_luggage"], cn: "寄存" },
    { char: "♿", keys: ["wheelchair"], cn: "轮椅" },
    { char: "🚭", keys: ["no_smoking"], cn: "禁烟" },
    { char: "🚾", keys: ["wc"], cn: "厕所" },
    { char: "🅿️", keys: ["parking"], cn: "停车" },
    { char: "🚰", keys: ["potable_water"], cn: "饮用水" },
    { char: "🚹", keys: ["mens"], cn: "男厕" },
    { char: "🚺", keys: ["womens"], cn: "女厕" },
    { char: "🚼", keys: ["baby"], cn: "婴儿室" },
    { char: "🚻", keys: ["restroom"], cn: "洗手间" },
    { char: "🚮", keys: ["put_litter"], cn: "扔垃圾" },
    { char: "🎦", keys: ["cinema"], cn: "电影院" },
    { char: "📶", keys: ["signal_strength"], cn: "信号" },
    { char: "🈁", keys: ["koko"], cn: "这里" },
    { char: "🆖", keys: ["ng"], cn: "NG" },
    { char: "🆗", keys: ["ok"], cn: "OK" },
    { char: "🆙", keys: ["up"], cn: "UP" },
    { char: "🆒", keys: ["cool"], cn: "COOL" },
    { char: "🆕", keys: ["new"], cn: "NEW" },
    { char: "🆓", keys: ["free"], cn: "FREE" },
    { char: "🔟", keys: ["keycap_ten"], cn: "十" },
    { char: "🔢", keys: ["input_numbers"], cn: "数字" },
    { char: "#️⃣", keys: ["hash"], cn: "井号" },
    { char: "*️⃣", keys: ["asterisk"], cn: "星号" },
    { char: "▶️", keys: ["play"], cn: "播放" },
    { char: "⏸️", keys: ["pause"], cn: "暂停" },
    { char: "⏯️", keys: ["play_pause"], cn: "播放暂停" },
    { char: "⏹️", keys: ["stop"], cn: "停止" },
    { char: "⏺️", keys: ["record"], cn: "录制" },
    { char: "⏭️", keys: ["next"], cn: "下一个" },
    { char: "⏮️", keys: ["previous"], cn: "上一个" },
    { char: "⏩", keys: ["fast_forward"], cn: "快进" },
    { char: "⏪", keys: ["rewind"], cn: "快退" },
    { char: "🔀", keys: ["shuffle"], cn: "随机" },
    { char: "🔁", keys: ["repeat"], cn: "重复" },
    { char: "🔂", keys: ["repeat_one"], cn: "单曲重复" },
    { char: "◀️", keys: ["arrow_backward"], cn: "左向箭头" },
    { char: "🔼", keys: ["arrow_up"], cn: "向上箭头" },
    { char: "🔽", keys: ["arrow_down"], cn: "向下箭头" },
    { char: "⏫", keys: ["arrow_double_up"], cn: "双上箭头" },
    { char: "⏬", keys: ["arrow_double_down"], cn: "双下箭头" },
    { char: "➡️", keys: ["arrow_right"], cn: "向右箭头" },
    { char: "⬅️", keys: ["arrow_left"], cn: "向左箭头" },
    { char: "⬆️", keys: ["arrow_up"], cn: "向上箭头" },
    { char: "⬇️", keys: ["arrow_down"], cn: "向下箭头" },
    { char: "↗️", keys: ["arrow_upper_right"], cn: "右上箭头" },
    { char: "↘️", keys: ["arrow_lower_right"], cn: "右下箭头" },
    { char: "↙️", keys: ["arrow_lower_left"], cn: "左下箭头" },
    { char: "↖️", keys: ["arrow_upper_left"], cn: "左上箭头" },
    { char: "↕️", keys: ["arrow_up_down"], cn: "上下箭头" },
    { char: "↔️", keys: ["arrow_left_right"], cn: "左右箭头" },
    { char: "🔄", keys: ["arrows_counterclockwise"], cn: "逆时针" },
    { char: "↪️", keys: ["arrow_right_hook"], cn: "右勾箭头" },
    { char: "↩️", keys: ["arrow_left_hook"], cn: "左勾箭头" },
    { char: "⤴️", keys: ["arrow_heading_up"], cn: "向上弯箭头" },
    { char: "⤵️", keys: ["arrow_heading_down"], cn: "向下弯箭头" },
    { char: "ℹ️", keys: ["information"], cn: "信息" },
    { char: "🔤", keys: ["abc"], cn: "ABC" },
    { char: "🔡", keys: ["abcd"], cn: "abcd" },
    { char: "🔠", keys: ["capital_abcd"], cn: "大写ABCD" },
    { char: "🔣", keys: ["symbols"], cn: "符号" },
    { char: "🎵", keys: ["musical_note"], cn: "音符" },
    { char: "🎶", keys: ["notes"], cn: "多个音符" },
    { char: "〰️", keys: ["wavy_dash"], cn: "波浪线" },
    { char: "➰", keys: ["curly_loop"], cn: "卷曲环" },
    { char: "✔️", keys: ["check"], cn: "勾" },
    { char: "🔃", keys: ["arrows_clockwise"], cn: "顺时针" },
    { char: "➕", keys: ["plus"], cn: "加号" },
    { char: "➖", keys: ["minus"], cn: "减号" },
    { char: "➗", keys: ["divide"], cn: "除号" },
    { char: "✖️", keys: ["multiply"], cn: "乘号" },
    { char: "💲", keys: ["dollar"], cn: "美元符号" },
    { char: "💱", keys: ["currency_exchange"], cn: "货币兑换" },
    { char: "©️", keys: ["copyright"], cn: "版权" },
    { char: "®️", keys: ["registered"], cn: "注册" },
    { char: "™️", keys: ["tm"], cn: "商标" },
    { char: "🔚", keys: ["end"], cn: "结束" },
    { char: "🔙", keys: ["back"], cn: "返回" },
    { char: "🔛", keys: ["on"], cn: "开启" },
    { char: "🔝", keys: ["top"], cn: "顶部" },
    { char: "🔜", keys: ["soon"], cn: "即将" },
    { char: "☑️", keys: ["ballot_box_with_check"], cn: "带勾方框" },
    { char: "🔘", keys: ["radio_button"], cn: "单选按钮" },
    { char: "⚪", keys: ["white_circle"], cn: "白圆" },
    { char: "⚫", keys: ["black_circle"], cn: "黑圆" },
    { char: "🔴", keys: ["red_circle"], cn: "红圆" },
    { char: "🔵", keys: ["blue_circle"], cn: "蓝圆" },
    { char: "🔸", keys: ["small_orange_diamond"], cn: "小橙菱" },
    { char: "🔹", keys: ["small_blue_diamond"], cn: "小蓝菱" },
    { char: "🔶", keys: ["large_orange_diamond"], cn: "大橙菱" },
    { char: "🔷", keys: ["large_blue_diamond"], cn: "大蓝菱" },
    { char: "🔺", keys: ["small_red_triangle"], cn: "红三角" },
    { char: "▪️", keys: ["small_black_square"], cn: "小黑方" },
    { char: "▫️", keys: ["small_white_square"], cn: "小白方" },
    { char: "⬛", keys: ["black_large_square"], cn: "大黑方" },
    { char: "⬜", keys: ["white_large_square"], cn: "大白方" },
    { char: "◼️", keys: ["black_medium_square"], cn: "中黑方" },
    { char: "◻️", keys: ["white_medium_square"], cn: "中白方" },
    { char: "◾", keys: ["black_medium_small_square"], cn: "中小黑方" },
    { char: "◽", keys: ["white_medium_small_square"], cn: "中小白方" },
    { char: "🔲", keys: ["black_square_button"], cn: "黑方按钮" },
    { char: "🔳", keys: ["white_square_button"], cn: "白方按钮" },
    { char: "🔈", keys: ["speaker"], cn: "喇叭" },
    { char: "🔉", keys: ["sound"], cn: "小声" },
    { char: "🔊", keys: ["loud_sound"], cn: "大声" },
    { char: "🔇", keys: ["mute"], cn: "静音" },
    { char: "📣", keys: ["megaphone"], cn: "扩音器" },
    { char: "📢", keys: ["loudspeaker"], cn: "喇叭" },
    { char: "🔔", keys: ["bell"], cn: "铃铛" },
    { char: "🔕", keys: ["no_bell"], cn: "禁止铃声" },
    { char: "🃏", keys: ["joker"], cn: "大王" },
    { char: "🀄", keys: ["mahjong"], cn: "麻将红中" },
    { char: "♠️", keys: ["spades"], cn: "黑桃" },
    { char: "♣️", keys: ["clubs"], cn: "梅花" },
    { char: "♥️", keys: ["hearts"], cn: "红桃" },
    { char: "♦️", keys: ["diamonds"], cn: "方片" },
    { char: "🎴", keys: ["flower_playing_cards"], cn: "花札" },
    { char: "💭", keys: ["thought_balloon"], cn: "思考气泡" },
    { char: "🗯️", keys: ["right_anger_bubble"], cn: "愤怒气泡" },
    { char: "💬", keys: ["speech_balloon"], cn: "对话气泡" },
    { char: "🗨️", keys: ["left_speech_bubble"], cn: "对话气泡" },
    { char: "🕐", keys: ["clock1"], cn: "1点" },
    { char: "🕑", keys: ["clock2"], cn: "2点" },
    { char: "🕒", keys: ["clock3"], cn: "3点" },
    { char: "🕓", keys: ["clock4"], cn: "4点" },
    { char: "🕔", keys: ["clock5"], cn: "5点" },
    { char: "🕕", keys: ["clock6"], cn: "6点" },
    { char: "🕖", keys: ["clock7"], cn: "7点" },
    { char: "🕗", keys: ["clock8"], cn: "8点" },
    { char: "🕘", keys: ["clock9"], cn: "9点" },
    { char: "🕙", keys: ["clock10"], cn: "10点" },
    { char: "🕚", keys: ["clock11"], cn: "11点" },
    { char: "🕛", keys: ["clock12"], cn: "12点" },
    { char: "🕜", keys: ["clock130"], cn: "1点半" },
    { char: "🕝", keys: ["clock230"], cn: "2点半" },
    { char: "🕞", keys: ["clock330"], cn: "3点半" },
    { char: "🕟", keys: ["clock430"], cn: "4点半" },
    { char: "🕠", keys: ["clock530"], cn: "5点半" },
    { char: "🕡", keys: ["clock630"], cn: "6点半" },
    { char: "🕢", keys: ["clock730"], cn: "7点半" },
    { char: "🕣", keys: ["clock830"], cn: "8点半" },
    { char: "🕤", keys: ["clock930"], cn: "9点半" },
    { char: "🕥", keys: ["clock1030"], cn: "10点半" },
    { char: "🕦", keys: ["clock1130"], cn: "11点半" },
    { char: "🕧", keys: ["clock1230"], cn: "12点半" },
    { char: "🏳️", keys: ["white_flag"], cn: "白旗" },
    { char: "🏴", keys: ["black_flag"], cn: "黑旗" },
    { char: "🏁", keys: ["checkered_flag"], cn: "赛车旗" },
    { char: "🚩", keys: ["triangular_flag_on_post"], cn: "三角旗" },
    { char: "🏳️‍🌈", keys: ["rainbow_flag"], cn: "彩虹旗" },
    { char: "🇦🇨", keys: ["flag_ac"], cn: "阿森松岛" },
    { char: "🇦🇩", keys: ["flag_ad"], cn: "安道尔" },
    { char: "🇦🇪", keys: ["flag_ae"], cn: "阿联酋" },
    { char: "🇦🇫", keys: ["flag_af"], cn: "阿富汗" },
    { char: "🇦🇬", keys: ["flag_ag"], cn: "安提瓜和巴布达" },
    { char: "🇦🇮", keys: ["flag_ai"], cn: "安圭拉" },
    { char: "🇦🇱", keys: ["flag_al"], cn: "阿尔巴尼亚" },
    { char: "🇦🇲", keys: ["flag_am"], cn: "亚美尼亚" },
    { char: "🇦🇴", keys: ["flag_ao"], cn: "安哥拉" },
    { char: "🇦🇶", keys: ["flag_aq"], cn: "南极洲" },
    { char: "🇦🇷", keys: ["flag_ar"], cn: "阿根廷" },
    { char: "🇦🇸", keys: ["flag_as"], cn: "美属萨摩亚" },
    { char: "🇦🇹", keys: ["flag_at"], cn: "奥地利" },
    { char: "🇦🇺", keys: ["flag_au"], cn: "澳大利亚" },
    { char: "🇦🇼", keys: ["flag_aw"], cn: "阿鲁巴" },
    { char: "🇦🇽", keys: ["flag_ax"], cn: "奥兰群岛" },
    { char: "🇦🇿", keys: ["flag_az"], cn: "阿塞拜疆" },
    { char: "🇧🇦", keys: ["flag_ba"], cn: "波黑" },
    { char: "🇧🇧", keys: ["flag_bb"], cn: "巴巴多斯" },
    { char: "🇧🇩", keys: ["flag_bd"], cn: "孟加拉国" },
    { char: "🇧🇪", keys: ["flag_be"], cn: "比利时" },
    { char: "🇧🇫", keys: ["flag_bf"], cn: "布基纳法索" },
    { char: "🇧🇬", keys: ["flag_bg"], cn: "保加利亚" },
    { char: "🇧🇭", keys: ["flag_bh"], cn: "巴林" },
    { char: "🇧🇮", keys: ["flag_bi"], cn: "布隆迪" },
    { char: "🇧🇯", keys: ["flag_bj"], cn: "贝宁" },
    { char: "🇧🇱", keys: ["flag_bl"], cn: "圣巴泰勒米" },
    { char: "🇧🇲", keys: ["flag_bm"], cn: "百慕大" },
    { char: "🇧🇳", keys: ["flag_bn"], cn: "文莱" },
    { char: "🇧🇴", keys: ["flag_bo"], cn: "玻利维亚" },
    { char: "🇧🇶", keys: ["flag_bq"], cn: "博内尔" },
    { char: "🇧🇷", keys: ["flag_br"], cn: "巴西" },
    { char: "🇧🇸", keys: ["flag_bs"], cn: "巴哈马" },
    { char: "🇧🇹", keys: ["flag_bt"], cn: "不丹" },
    { char: "🇧🇻", keys: ["flag_bv"], cn: "布维岛" },
    { char: "🇧🇼", keys: ["flag_bw"], cn: "博茨瓦纳" },
    { char: "🇧🇾", keys: ["flag_by"], cn: "白俄罗斯" },
    { char: "🇧🇿", keys: ["flag_bz"], cn: "伯利兹" },
    { char: "🇨🇦", keys: ["flag_ca"], cn: "加拿大" },
    { char: "🇨🇨", keys: ["flag_cc"], cn: "科科斯群岛" },
    { char: "🇨🇩", keys: ["flag_cd"], cn: "刚果金" },
    { char: "🇨🇫", keys: ["flag_cf"], cn: "中非" },
    { char: "🇨🇬", keys: ["flag_cg"], cn: "刚果布" },
    { char: "🇨🇭", keys: ["flag_ch"], cn: "瑞士" },
    { char: "🇨🇮", keys: ["flag_ci"], cn: "科特迪瓦" },
    { char: "🇨🇰", keys: ["flag_ck"], cn: "库克群岛" },
    { char: "🇨🇱", keys: ["flag_cl"], cn: "智利" },
    { char: "🇨🇲", keys: ["flag_cm"], cn: "喀麦隆" },
    { char: "🇨🇳", keys: ["flag_cn"], cn: "中国" },
    { char: "🇨🇴", keys: ["flag_co"], cn: "哥伦比亚" },
    { char: "🇨🇵", keys: ["flag_cp"], cn: "克利珀顿岛" },
    { char: "🇨🇷", keys: ["flag_cr"], cn: "哥斯达黎加" },
    { char: "🇨🇺", keys: ["flag_cu"], cn: "古巴" },
    { char: "🇨🇻", keys: ["flag_cv"], cn: "佛得角" },
    { char: "🇨🇼", keys: ["flag_cw"], cn: "库拉索" },
    { char: "🇨🇽", keys: ["flag_cx"], cn: "圣诞岛" },
    { char: "🇨🇾", keys: ["flag_cy"], cn: "塞浦路斯" },
    { char: "🇨🇿", keys: ["flag_cz"], cn: "捷克" },
    { char: "🇩🇪", keys: ["flag_de"], cn: "德国" },
    { char: "🇩🇬", keys: ["flag_dg"], cn: "迪戈加西亚" },
    { char: "🇩🇯", keys: ["flag_dj"], cn: "吉布提" },
    { char: "🇩🇰", keys: ["flag_dk"], cn: "丹麦" },
    { char: "🇩🇲", keys: ["flag_dm"], cn: "多米尼克" },
    { char: "🇩🇴", keys: ["flag_do"], cn: "多米尼加" },
    { char: "🇩🇿", keys: ["flag_dz"], cn: "阿尔及利亚" },
    { char: "🇪🇦", keys: ["flag_ea"], cn: "休达梅利利亚" },
    { char: "🇪🇨", keys: ["flag_ec"], cn: "厄瓜多尔" },
    { char: "🇪🇪", keys: ["flag_ee"], cn: "爱沙尼亚" },
    { char: "🇪🇬", keys: ["flag_eg"], cn: "埃及" },
    { char: "🇪🇭", keys: ["flag_eh"], cn: "西撒哈拉" },
    { char: "🇪🇷", keys: ["flag_er"], cn: "厄立特里亚" },
    { char: "🇪🇸", keys: ["flag_es"], cn: "西班牙" },
    { char: "🇪🇹", keys: ["flag_et"], cn: "埃塞俄比亚" },
    { char: "🇪🇺", keys: ["flag_eu"], cn: "欧盟" },
    { char: "🇫🇮", keys: ["flag_fi"], cn: "芬兰" },
    { char: "🇫🇯", keys: ["flag_fj"], cn: "斐济" },
    { char: "🇫🇰", keys: ["flag_fk"], cn: "福克兰群岛" },
    { char: "🇫🇲", keys: ["flag_fm"], cn: "密克罗尼西亚" },
    { char: "🇫🇴", keys: ["flag_fo"], cn: "法罗群岛" },
    { char: "🇫🇷", keys: ["flag_fr"], cn: "法国" },
    { char: "🇬🇦", keys: ["flag_ga"], cn: "加蓬" },
    { char: "🇬🇧", keys: ["flag_gb"], cn: "英国" },
    { char: "🇬🇩", keys: ["flag_gd"], cn: "格林纳达" },
    { char: "🇬🇪", keys: ["flag_ge"], cn: "格鲁吉亚" },
    { char: "🇬🇫", keys: ["flag_gf"], cn: "法属圭亚那" },
    { char: "🇬🇬", keys: ["flag_gg"], cn: "根西岛" },
    { char: "🇬🇭", keys: ["flag_gh"], cn: "加纳" },
    { char: "🇬🇮", keys: ["flag_gi"], cn: "直布罗陀" },
    { char: "🇬🇱", keys: ["flag_gl"], cn: "格陵兰" },
    { char: "🇬🇲", keys: ["flag_gm"], cn: "冈比亚" },
    { char: "🇬🇳", keys: ["flag_gn"], cn: "几内亚" },
    { char: "🇬🇵", keys: ["flag_gp"], cn: "瓜德罗普" },
    { char: "🇬🇶", keys: ["flag_gq"], cn: "赤道几内亚" },
    { char: "🇬🇷", keys: ["flag_gr"], cn: "希腊" },
    { char: "🇬🇸", keys: ["flag_gs"], cn: "南乔治亚" },
    { char: "🇬🇹", keys: ["flag_gt"], cn: "危地马拉" },
    { char: "🇬🇺", keys: ["flag_gu"], cn: "关岛" },
    { char: "🇬🇼", keys: ["flag_gw"], cn: "几内亚比绍" },
    { char: "🇬🇾", keys: ["flag_gy"], cn: "圭亚那" },
    { char: "🇭🇰", keys: ["flag_hk"], cn: "香港" },
    { char: "🇭🇲", keys: ["flag_hm"], cn: "赫德岛" },
    { char: "🇭🇳", keys: ["flag_hn"], cn: "洪都拉斯" },
    { char: "🇭🇷", keys: ["flag_hr"], cn: "克罗地亚" },
    { char: "🇭🇹", keys: ["flag_ht"], cn: "海地" },
    { char: "🇭🇺", keys: ["flag_hu"], cn: "匈牙利" },
    { char: "🇮🇨", keys: ["flag_ic"], cn: "加那利群岛" },
    { char: "🇮🇩", keys: ["flag_id"], cn: "印尼" },
    { char: "🇮🇪", keys: ["flag_ie"], cn: "爱尔兰" },
    { char: "🇮🇱", keys: ["flag_il"], cn: "以色列" },
    { char: "🇮🇲", keys: ["flag_im"], cn: "马恩岛" },
    { char: "🇮🇳", keys: ["flag_in"], cn: "印度" },
    { char: "🇮🇴", keys: ["flag_io"], cn: "英属印度洋" },
    { char: "🇮🇶", keys: ["flag_iq"], cn: "伊拉克" },
    { char: "🇮🇷", keys: ["flag_ir"], cn: "伊朗" },
    { char: "🇮🇸", keys: ["flag_is"], cn: "冰岛" },
    { char: "🇮🇹", keys: ["flag_it"], cn: "意大利" },
    { char: "🇯🇪", keys: ["flag_je"], cn: "泽西岛" },
    { char: "🇯🇲", keys: ["flag_jm"], cn: "牙买加" },
    { char: "🇯🇴", keys: ["flag_jo"], cn: "约旦" },
    { char: "🇯🇵", keys: ["flag_jp"], cn: "日本" },
    { char: "🇰🇪", keys: ["flag_ke"], cn: "肯尼亚" },
    { char: "🇰🇬", keys: ["flag_kg"], cn: "吉尔吉斯斯坦" },
    { char: "🇰🇭", keys: ["flag_kh"], cn: "柬埔寨" },
    { char: "🇰🇮", keys: ["flag_ki"], cn: "基里巴斯" },
    { char: "🇰🇲", keys: ["flag_km"], cn: "科摩罗" },
    { char: "🇰🇳", keys: ["flag_kn"], cn: "圣基茨" },
    { char: "🇰🇵", keys: ["flag_kp"], cn: "朝鲜" },
    { char: "🇰🇷", keys: ["flag_kr"], cn: "韩国" },
    { char: "🇰🇼", keys: ["flag_kw"], cn: "科威特" },
    { char: "🇰🇾", keys: ["flag_ky"], cn: "开曼群岛" },
    { char: "🇰🇿", keys: ["flag_kz"], cn: "哈萨克斯坦" },
    { char: "🇱🇦", keys: ["flag_la"], cn: "老挝" },
    { char: "🇱🇧", keys: ["flag_lb"], cn: "黎巴嫩" },
    { char: "🇱🇨", keys: ["flag_lc"], cn: "圣卢西亚" },
    { char: "🇱🇮", keys: ["flag_li"], cn: "列支敦士登" },
    { char: "🇱🇰", keys: ["flag_lk"], cn: "斯里兰卡" },
    { char: "🇱🇷", keys: ["flag_lr"], cn: "利比里亚" },
    { char: "🇱🇸", keys: ["flag_ls"], cn: "莱索托" },
    { char: "🇱🇹", keys: ["flag_lt"], cn: "立陶宛" },
    { char: "🇱🇺", keys: ["flag_lu"], cn: "卢森堡" },
    { char: "🇱🇻", keys: ["flag_lv"], cn: "拉脱维亚" },
    { char: "🇱🇾", keys: ["flag_ly"], cn: "利比亚" },
    { char: "🇲🇦", keys: ["flag_ma"], cn: "摩洛哥" },
    { char: "🇲🇨", keys: ["flag_mc"], cn: "摩纳哥" },
    { char: "🇲🇩", keys: ["flag_md"], cn: "摩尔多瓦" },
    { char: "🇲🇪", keys: ["flag_me"], cn: "黑山" },
    { char: "🇲🇫", keys: ["flag_mf"], cn: "法属圣马丁" },
    { char: "🇲🇬", keys: ["flag_mg"], cn: "马达加斯加" },
    { char: "🇲🇭", keys: ["flag_mh"], cn: "马绍尔群岛" },
    { char: "🇲🇰", keys: ["flag_mk"], cn: "北马其顿" },
    { char: "🇲🇱", keys: ["flag_ml"], cn: "马里" },
    { char: "🇲🇲", keys: ["flag_mm"], cn: "缅甸" },
    { char: "🇲🇳", keys: ["flag_mn"], cn: "蒙古" },
    { char: "🇲🇴", keys: ["flag_mo"], cn: "澳门" },
    { char: "🇲🇵", keys: ["flag_mp"], cn: "北马里亚纳" },
    { char: "🇲🇶", keys: ["flag_mq"], cn: "马提尼克" },
    { char: "🇲🇷", keys: ["flag_mr"], cn: "毛里塔尼亚" },
    { char: "🇲🇸", keys: ["flag_ms"], cn: "蒙特塞拉特" },
    { char: "🇲🇹", keys: ["flag_mt"], cn: "马耳他" },
    { char: "🇲🇺", keys: ["flag_mu"], cn: "毛里求斯" },
    { char: "🇲🇻", keys: ["flag_mv"], cn: "马尔代夫" },
    { char: "🇲🇼", keys: ["flag_mw"], cn: "马拉维" },
    { char: "🇲🇽", keys: ["flag_mx"], cn: "墨西哥" },
    { char: "🇲🇾", keys: ["flag_my"], cn: "马来西亚" },
    { char: "🇲🇿", keys: ["flag_mz"], cn: "莫桑比克" },
    { char: "🇳🇦", keys: ["flag_na"], cn: "纳米比亚" },
    { char: "🇳🇨", keys: ["flag_nc"], cn: "新喀里多尼亚" },
    { char: "🇳🇪", keys: ["flag_ne"], cn: "尼日尔" },
    { char: "🇳🇫", keys: ["flag_nf"], cn: "诺福克岛" },
    { char: "🇳🇬", keys: ["flag_ng"], cn: "尼日利亚" },
    { char: "🇳🇮", keys: ["flag_ni"], cn: "尼加拉瓜" },
    { char: "🇳🇱", keys: ["flag_nl"], cn: "荷兰" },
    { char: "🇳🇴", keys: ["flag_no"], cn: "挪威" },
    { char: "🇳🇵", keys: ["flag_np"], cn: "尼泊尔" },
    { char: "🇳🇷", keys: ["flag_nr"], cn: "瑙鲁" },
    { char: "🇳🇺", keys: ["flag_nu"], cn: "纽埃" },
    { char: "🇳🇿", keys: ["flag_nz"], cn: "新西兰" },
    { char: "🇴🇲", keys: ["flag_om"], cn: "阿曼" },
    { char: "🇵🇦", keys: ["flag_pa"], cn: "巴拿马" },
    { char: "🇵🇪", keys: ["flag_pe"], cn: "秘鲁" },
    { char: "🇵🇫", keys: ["flag_pf"], cn: "法属波利尼西亚" },
    { char: "🇵🇬", keys: ["flag_pg"], cn: "巴布亚新几内亚" },
    { char: "🇵🇭", keys: ["flag_ph"], cn: "菲律宾" },
    { char: "🇵🇰", keys: ["flag_pk"], cn: "巴基斯坦" },
    { char: "🇵🇱", keys: ["flag_pl"], cn: "波兰" },
    { char: "🇵🇲", keys: ["flag_pm"], cn: "圣皮埃尔" },
    { char: "🇵🇳", keys: ["flag_pn"], cn: "皮特凯恩" },
    { char: "🇵🇷", keys: ["flag_pr"], cn: "波多黎各" },
    { char: "🇵🇸", keys: ["flag_ps"], cn: "巴勒斯坦" },
    { char: "🇵🇹", keys: ["flag_pt"], cn: "葡萄牙" },
    { char: "🇵🇼", keys: ["flag_pw"], cn: "帕劳" },
    { char: "🇵🇾", keys: ["flag_py"], cn: "巴拉圭" },
    { char: "🇶🇦", keys: ["flag_qa"], cn: "卡塔尔" },
    { char: "🇷🇪", keys: ["flag_re"], cn: "留尼汪" },
    { char: "🇷🇴", keys: ["flag_ro"], cn: "罗马尼亚" },
    { char: "🇷🇸", keys: ["flag_rs"], cn: "塞尔维亚" },
    { char: "🇷🇺", keys: ["flag_ru"], cn: "俄罗斯" },
    { char: "🇷🇼", keys: ["flag_rw"], cn: "卢旺达" },
    { char: "🇸🇦", keys: ["flag_sa"], cn: "沙特" },
    { char: "🇸🇧", keys: ["flag_sb"], cn: "所罗门群岛" },
    { char: "🇸🇨", keys: ["flag_sc"], cn: "塞舌尔" },
    { char: "🇸🇩", keys: ["flag_sd"], cn: "苏丹" },
    { char: "🇸🇪", keys: ["flag_se"], cn: "瑞典" },
    { char: "🇸🇬", keys: ["flag_sg"], cn: "新加坡" },
    { char: "🇸🇭", keys: ["flag_sh"], cn: "圣赫勒拿" },
    { char: "🇸🇮", keys: ["flag_si"], cn: "斯洛文尼亚" },
    { char: "🇸🇯", keys: ["flag_sj"], cn: "斯瓦尔巴" },
    { char: "🇸🇰", keys: ["flag_sk"], cn: "斯洛伐克" },
    { char: "🇸🇱", keys: ["flag_sl"], cn: "塞拉利昂" },
    { char: "🇸🇲", keys: ["flag_sm"], cn: "圣马力诺" },
    { char: "🇸🇳", keys: ["flag_sn"], cn: "塞内加尔" },
    { char: "🇸🇴", keys: ["flag_so"], cn: "索马里" },
    { char: "🇸🇷", keys: ["flag_sr"], cn: "苏里南" },
    { char: "🇸🇸", keys: ["flag_ss"], cn: "南苏丹" },
    { char: "🇸🇹", keys: ["flag_st"], cn: "圣多美" },
    { char: "🇸🇻", keys: ["flag_sv"], cn: "萨尔瓦多" },
    { char: "🇸🇽", keys: ["flag_sx"], cn: "荷属圣马丁" },
    { char: "🇸🇾", keys: ["flag_sy"], cn: "叙利亚" },
    { char: "🇸🇿", keys: ["flag_sz"], cn: "斯威士兰" },
    { char: "🇹🇦", keys: ["flag_ta"], cn: "特里斯坦" },
    { char: "🇹🇨", keys: ["flag_tc"], cn: "特克斯凯科斯" },
    { char: "🇹🇩", keys: ["flag_td"], cn: "乍得" },
    { char: "🇹🇫", keys: ["flag_tf"], cn: "法属南部领地" },
    { char: "🇹🇬", keys: ["flag_tg"], cn: "多哥" },
    { char: "🇹🇭", keys: ["flag_th"], cn: "泰国" },
    { char: "🇹🇯", keys: ["flag_tj"], cn: "塔吉克斯坦" },
    { char: "🇹🇰", keys: ["flag_tk"], cn: "托克劳" },
    { char: "🇹🇱", keys: ["flag_tl"], cn: "东帝汶" },
    { char: "🇹🇲", keys: ["flag_tm"], cn: "土库曼斯坦" },
    { char: "🇹🇳", keys: ["flag_tn"], cn: "突尼斯" },
    { char: "🇹🇴", keys: ["flag_to"], cn: "汤加" },
    { char: "🇹🇷", keys: ["flag_tr"], cn: "土耳其" },
    { char: "🇹🇹", keys: ["flag_tt"], cn: "特立尼达" },
    { char: "🇹🇻", keys: ["flag_tv"], cn: "图瓦卢" },
    { char: "🇹🇼", keys: ["flag_tw"], cn: "台湾" },
    { char: "🇹🇿", keys: ["flag_tz"], cn: "坦桑尼亚" },
    { char: "🇺🇦", keys: ["flag_ua"], cn: "乌克兰" },
    { char: "🇺🇬", keys: ["flag_ug"], cn: "乌干达" },
    { char: "🇺🇲", keys: ["flag_um"], cn: "美国本土外" },
    { char: "🇺🇳", keys: ["flag_un"], cn: "联合国" },
    { char: "🇺🇸", keys: ["flag_us"], cn: "美国" },
    { char: "🇺🇾", keys: ["flag_uy"], cn: "乌拉圭" },
    { char: "🇺🇿", keys: ["flag_uz"], cn: "乌兹别克斯坦" },
    { char: "🇻🇦", keys: ["flag_va"], cn: "梵蒂冈" },
    { char: "🇻🇨", keys: ["flag_vc"], cn: "圣文森特" },
    { char: "🇻🇪", keys: ["flag_ve"], cn: "委内瑞拉" },
    { char: "🇻🇬", keys: ["flag_vg"], cn: "英属维尔京" },
    { char: "🇻🇮", keys: ["flag_vi"], cn: "美属维尔京" },
    { char: "🇻🇳", keys: ["flag_vn"], cn: "越南" },
    { char: "🇻🇺", keys: ["flag_vu"], cn: "瓦努阿图" },
    { char: "🇼🇫", keys: ["flag_wf"], cn: "瓦利斯" },
    { char: "🇼🇸", keys: ["flag_ws"], cn: "萨摩亚" },
    { char: "🇽🇰", keys: ["flag_xk"], cn: "科索沃" },
    { char: "🇾🇪", keys: ["flag_ye"], cn: "也门" },
    { char: "🇾🇹", keys: ["flag_yt"], cn: "马约特" },
    { char: "🇿🇦", keys: ["flag_za"], cn: "南非" },
    { char: "🇿🇲", keys: ["flag_zm"], cn: "赞比亚" },
    { char: "🇿🇼", keys: ["flag_zw"], cn: "津巴布韦" },
    { char: "✨", keys: ["sparkles"], cn: "闪光 亮" },
    { char: "🎉", keys: ["tada"], cn: "庆祝 撒花" }
  ];
  function init() {
    const inputEl = document.getElementById('input');
    if (!inputEl) {
      setTimeout(init, 1000);
      return;
    }

    if (document.getElementById('tl-native-emoji-btn')) return;

    // 获取输入框的父容器 (通常是 form#form)
    const container = inputEl.parentElement; // 或者 document.getElementById('form');

    // --- 按钮 ---
    const btn = document.createElement('div');
    btn.id = 'tl-native-emoji-btn';
    btn.innerHTML = '🙂';
    btn.style.cssText = `
      font-size: 22px;
      cursor: pointer;
      padding: 0 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--body-color-muted, #888);
      transition: color 0.2s;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      margin-right: 5px; /* 距离右侧发送按钮一点距离 */
      flex-shrink: 0;
    `;

    // --- 面板容器 ---
    const panel = document.createElement('div');
    panel.id = 'tl-native-emoji-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 60px;
      right: 10px;
      width: 320px;
      max-width: 95vw;
      max-height: 55vh;
      background-color: var(--window-bg-color, #222);
      border: 1px solid var(--primary-color, #444);
      border-radius: 8px;
      padding: 10px;
      display: none;
      flex-direction: column;
      z-index: 20000;
      box-shadow: 0 -5px 20px rgba(0,0,0,0.5);
    `;

    // --- 1. 搜索框 ---
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索表情...';
    searchInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      margin-bottom: 10px;
      border-radius: 20px;
      border: 1px solid var(--input-border-color, #555);
      background-color: var(--input-bg-color, rgba(0,0,0,0.2));
      color: var(--body-color, inherit);
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
    `;

    searchInput.onfocus = () => { searchInput.style.borderColor = 'var(--link-color, #00bc8c)'; };
    searchInput.onblur = () => { searchInput.style.borderColor = 'var(--input-border-color, #555)'; };

    // --- 2. 网格 ---
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
      gap: 4px;
      overflow-y: auto;
      flex: 1;
      -webkit-overflow-scrolling: touch;
      padding-right: 4px;
    `;

    // 滚动条样式
    const style = document.createElement('style');
    style.innerHTML = `
      #tl-native-emoji-panel ::-webkit-scrollbar { width: 6px; }
      #tl-native-emoji-panel ::-webkit-scrollbar-thumb { background: #666; border-radius: 3px; }
    `;
    document.head.appendChild(style);

    function renderEmojis(filterText = "") {
      grid.innerHTML = "";
      const searchText = filterText.toLowerCase().trim();
      let count = 0;

      emojiDatabase.forEach(item => {
        const match = !searchText ||
                      item.char.includes(searchText) ||
                      item.keys.some(k => k.toLowerCase().includes(searchText)) ||
                      item.cn.includes(searchText);

        if (match) {
          const el = document.createElement('div');
          el.textContent = item.char;
          el.title = item.cn.split(' ')[0];
          el.style.cssText = `
            font-size: 24px;
            text-align: center;
            padding: 6px 0;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.1s;
          `;
          el.onmouseover = () => { el.style.backgroundColor = 'var(--highlight-bg-color, rgba(255,255,255,0.1))'; };
          el.onmouseout = () => { el.style.backgroundColor = 'transparent'; };

          const insertHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            insertText(inputEl, item.char);
          };
          el.addEventListener('click', insertHandler);
          el.addEventListener('touchend', insertHandler);
          grid.appendChild(el);
          count++;
        }
      });

      if (count === 0) {
         const emptyMsg = document.createElement('div');
         emptyMsg.textContent = "没找到... 😅";
         emptyMsg.style.color = "#888";
         emptyMsg.style.gridColumn = "1 / -1";
         emptyMsg.style.textAlign = "center";
         emptyMsg.style.padding = "20px";
         grid.appendChild(emptyMsg);
      }
    }

    renderEmojis();
    searchInput.addEventListener('input', (e) => renderEmojis(e.target.value));
    panel.appendChild(searchInput);
    panel.appendChild(grid);
    document.body.appendChild(panel);

    // --- 【V4.2 关键修正】插入位置逻辑 ---
    // 目标： [输入框] ... [🙂 表情按钮] [➤ 发送按钮 (Wrapper)]
    // 策略：找到 id="submit-tooltip" 的 span，然后插在它前面。

    const sendWrapper = document.getElementById('submit-tooltip');
    const sendBtn = document.getElementById('submit');

    if (sendWrapper) {
      // 优先匹配 Wrapper，插在 Wrapper 前面
      // parentNode.insertBefore(new, reference) -> 插入到 reference 左边
      sendWrapper.parentNode.insertBefore(btn, sendWrapper);
    } else if (sendBtn) {
      // 如果 Wrapper 没找到，尝试找按钮本身，插在按钮前面
      sendBtn.parentNode.insertBefore(btn, sendBtn);
    } else {
      // 实在找不到，就放到容器最后
      container.appendChild(btn);
    }

    // --- 交互逻辑 ---
    const togglePanel = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isVisible = panel.style.display === 'flex';
      if (isVisible) {
        panel.style.display = 'none';
        btn.style.color = 'var(--body-color-muted, #888)';
      } else {
        panel.style.display = 'flex';
        btn.style.color = 'var(--link-color, #00bc8c)';
        searchInput.value = '';
        renderEmojis();

        // 智能定位
        const rect = btn.getBoundingClientRect();
        if (window.innerWidth < 600) {
             panel.style.right = '5px';
             panel.style.left = '5px';
             panel.style.width = 'auto';
             panel.style.bottom = '60px';
        } else {
             panel.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
             let leftPos = rect.left - 160 + (rect.width / 2);
             if (leftPos + 320 > window.innerWidth) leftPos = window.innerWidth - 330;
             if (leftPos < 10) leftPos = 10;
             panel.style.left = leftPos + 'px';
             panel.style.width = '320px';
        }
        if (window.innerWidth > 600) setTimeout(() => searchInput.focus(), 50);
      }
    };

    btn.addEventListener('click', togglePanel);
    btn.addEventListener('touchend', togglePanel);

    document.addEventListener('click', (e) => {
      if (e.target !== btn && !btn.contains(e.target) && !panel.contains(e.target)) {
        panel.style.display = 'none';
        btn.style.color = 'var(--body-color-muted, #888)';
      }
    });
  }

  function insertText(input, text) {
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    const val = input.value;
    input.value = val.substring(0, start) + text + val.substring(end);
    input.selectionStart = input.selectionEnd = start + text.length;
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  setTimeout(init, 1500);
})();
