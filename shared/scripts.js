/**
 * 依据 UAX #24 Script 属性为码位分组（前后端共用的纯 ESM 模块）。
 * 使用浏览器 / Node 内置的 Unicode 属性转义 \p{sc=...}，无需自带数据文件。
 * 运行时不支持的脚本名会被静默跳过，最终归入 Unknown。
 *
 * @module shared/scripts
 */

/**
 * UAX #24 全部脚本（短名），第二项是常用脚本的中文展示名（无则回退英文长名）。
 * @type {[string, string|null][]}
 */
const SCRIPTS = [
  ['Adlm', '阿德拉姆文'], ['Ahom', '阿洪姆文'], ['Hluw', '安纳托利亚象形文'],
  ['Arab', '阿拉伯文'], ['Armn', '亚美尼亚文'], ['Avst', '阿维斯陀文'],
  ['Bali', '巴厘文'], ['Bamu', '巴姆穆文'], ['Bass', '巴萨瓦赫文'],
  ['Batk', '巴塔克文'], ['Beng', '孟加拉文'], ['Bhks', '拜克舒基文'],
  ['Bopo', '注音符号'], ['Brah', '婆罗米文'], ['Brai', '盲文'],
  ['Bugi', '布吉文'], ['Buhd', '布希德文'], ['Cans', '加拿大原住民音节文'],
  ['Cari', '卡里亚文'], ['Aghb', '高加索阿尔巴尼亚文'], ['Cakm', '查克马文'],
  ['Cham', '占文'], ['Cher', '切罗基文'], ['Chrs', '花剌子模文'],
  ['Copt', '科普特文'], ['Xsux', '楔形文字'], ['Cprt', '塞浦路斯音节文'],
  ['Cyrl', '西里尔文'], ['Cpmn', '塞浦路斯-米诺斯文'], ['Dsrt', '德塞雷特文'],
  ['Deva', '天城文'], ['Diak', '迪维希阿库鲁文'], ['Dogr', '多格拉文'],
  ['Dupl', '迪普卢瓦耶速记'], ['Egyp', '埃及象形文'], ['Elba', '艾尔巴桑文'],
  ['Elym', '埃利迈斯文'], ['Ethi', '埃塞俄比亚文'], ['Gara', '加雷文'],
  ['Geor', '格鲁吉亚文'], ['Glag', '格拉哥里文'], ['Goth', '哥特文'],
  ['Gran', '格兰塔文'], ['Grek', '希腊文'], ['Gujr', '古吉拉特文'],
  ['Gong', '贡贾拉贡德文'], ['Gukh', '古隆凯玛文'], ['Guru', '古尔穆基文'],
  ['Hani', '汉字'], ['Hang', '谚文'], ['Rohg', '哈尼菲罗兴亚文'],
  ['Hano', '哈努诺文'], ['Hatr', '哈特拉文'], ['Hebr', '希伯来文'],
  ['Hira', '平假名'], ['Armi', '帝国阿拉姆文'], ['Phli', '碑铭巴列维文'],
  ['Prti', '碑铭帕提亚文'], ['Java', '爪哇文'], ['Kthi', '凯提文'],
  ['Knda', '卡纳达文'], ['Kana', '片假名'], ['Kawi', '卡威文'],
  ['Kali', '克耶列文'], ['Khar', '佉卢文'], ['Kits', '契丹小字'],
  ['Khmr', '高棉文'], ['Khoj', '科杰基文'], ['Sind', '库达瓦迪文'],
  ['Krai', '基拉特拉伊文'], ['Laoo', '老挝文'], ['Latn', '拉丁文'],
  ['Lepc', '雷布查文'], ['Limb', '林布文'], ['Lina', '线性文字 A'],
  ['Linb', '线性文字 B'], ['Lisu', '傈僳文'], ['Lyci', '利西亚文'],
  ['Lydi', '吕底亚文'], ['Maka', '望加锡文'], ['Mlym', '马拉雅拉姆文'],
  ['Mand', '曼达文'], ['Mani', '摩尼教文'], ['Marc', '马钦文'],
  ['Gonm', '马萨拉姆贡德文'], ['Medf', '梅德法伊德林文'], ['Mtei', '梅泰梅耶克文'],
  ['Mend', '门德基卡库文'], ['Merc', '麦罗埃草书'], ['Mero', '麦罗埃象形文'],
  ['Plrd', '坡拉德苗文'], ['Modi', '莫迪文'], ['Mong', '蒙古文'],
  ['Mroo', '穆鲁文'], ['Mult', '穆尔塔尼文'], ['Mymr', '缅甸文'],
  ['Nbat', '纳巴泰文'], ['Nagm', '纳格蒙达里文'], ['Nand', '南迪城文'],
  ['Talu', '新傣仂文'], ['Newa', '内瓦尔文'], ['Nkoo', '西非书面语 (N’Ko)'],
  ['Nshu', '女书'], ['Hmnp', '尼亚肯普楚赫苗文'], ['Ogam', '欧甘文'],
  ['Olck', '奥尔奇基文'], ['Onao', '奥尔奥纳尔文'], ['Hung', '古匈牙利文'],
  ['Ital', '古意大利文'], ['Narb', '古北阿拉伯文'], ['Xpeo', '古波斯文'],
  ['Perm', '古彼尔姆文'], ['Sogo', '古粟特文'], ['Sarb', '古南阿拉伯文'],
  ['Orkh', '古突厥文'], ['Ougr', '古回鹘文'], ['Orya', '奥里亚文'],
  ['Osge', '奥塞奇文'], ['Osma', '奥斯曼亚文'], ['Hmng', '巴哈维苗文'],
  ['Palm', '帕尔迈拉文'], ['Pauc', '保钦豪文'], ['Phag', '八思巴文'],
  ['Phnx', '腓尼基文'], ['Phlp', '圣咏集巴列维文'], ['Rjng', '勒姜文'],
  ['Runr', '卢恩文'], ['Samr', '撒玛利亚文'], ['Saur', '索拉什特拉文'],
  ['Shrd', '夏拉达文'], ['Shaw', '萧伯纳文'], ['Sidd', '悉昙文'],
  ['Sgnw', '手语书写文字'], ['Sinh', '僧伽罗文'], ['Sogd', '粟特文'],
  ['Sora', '索拉僧平文'], ['Soyo', '索永布文'], ['Sund', '巽他文'],
  ['Sunu', '苏努瓦尔文'], ['Sylo', '锡尔赫特文'], ['Syrc', '叙利亚文'],
  ['Tglg', '他加禄文'], ['Tagb', '塔格班瓦文'], ['Tale', '德宏傣文'],
  ['Lana', '兰纳文'], ['Tavt', '越南傣文'], ['Takr', '塔克里文'],
  ['Taml', '泰米尔文'], ['Tang', '西夏文'], ['Telu', '泰卢固文'],
  ['Thaa', '它拿文'], ['Thai', '泰文'], ['Tibt', '藏文'],
  ['Tfng', '提非纳文'], ['Tirh', '提尔胡塔文'], ['Tnsa', '唐萨文'],
  ['Toto', '托托文'], ['Ugar', '乌加里特文'], ['Vaii', '瓦伊文'],
  ['Vith', '维特库奇文'], ['Wcho', '万乔文'], ['Wara', '瓦兰奇提文'],
  ['Yezi', '耶齐迪文'], ['Yiii', '彝文'], ['Zanb', '扎纳巴扎尔方形文'],
];

const SPECIAL = [
  ['Zyyy', '通用 (Common)'],
  ['Zinh', '继承 (Inherited)'],
  ['Zzzz', '未分配 / 未知 (Unknown)'],
];

/** @type {{id:string,label:string,re:RegExp}[]} */
let table = null;
/** @type {Map<number,string>} 码位 → 脚本 id 的进程内缓存 */
const cpCache = new Map();

function buildTable() {
  if (table) return table;
  table = [];
  const add = (id, label) => {
    try {
      table.push({ id, label, re: new RegExp(`\\p{sc=${id}}`, 'u') });
    } catch {
      /* 旧版引擎不认识该脚本，跳过并最终归入 Zzzz */
    }
  };
  for (const [id, zh] of SCRIPTS) add(id, zh ?? id);
  for (const [id, label] of SPECIAL) add(id, label);
  return table;
}

/**
 * 返回码位的脚本信息。
 * @param {number} cp
 * @returns {{id:string,label:string}}
 */
export function scriptOf(cp) {
  const cached = cpCache.get(cp);
  if (cached !== undefined) {
    return { id: cached, label: labelOf(cached) };
  }
  const ch = String.fromCodePoint(cp);
  let id = 'Zzzz';
  for (const row of buildTable()) {
    if (row.re.test(ch)) {
      id = row.id;
      break;
    }
  }
  cpCache.set(cp, id);
  return { id, label: labelOf(id) };
}

function labelOf(id) {
  const row = buildTable().find((r) => r.id === id);
  return row ? row.label : id;
}

/** 清空码位缓存（对比大批量码位时可选） */
export function clearScriptCache() {
  cpCache.clear();
}
