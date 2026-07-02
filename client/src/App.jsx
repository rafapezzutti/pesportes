import React, { useState, useEffect, useCallback } from 'react';
import {
  authApi, estApi, pointApi, userApi, resApi, dashboardApi,
  professorApi, planoApi, barApi, manutencaoApi, dashClienteApi, profEfApi,
  auditApi, repasseApi, expenseApi, financeApi, reviewApi, barProdutoApi,
  employeeApi, pontoApi, alunoApi, contasApi, impersonateApi, recurringApi,
  whatsappApi, comissaoGerenteApi, horariosLivresApi, downloadReport, saveToken, clearToken,
} from './api';

// ================================================================
// CONSTANTS
// ================================================================
const ESTABLISHMENT_TYPES = [
  'Quadra de Tênis','Quadra de Beach','Quadra de Pickleball',
  'Quadra de Squash','Quadra de Futebol de Salão','Quadra de Futebol Society','Campo de Futebol',
  'Salão de Festa','Churrasqueira',
];
const DAYS = [
  {key:'seg',label:'Seg'},{key:'ter',label:'Ter'},{key:'qua',label:'Qua'},
  {key:'qui',label:'Qui'},{key:'sex',label:'Sex'},{key:'sab',label:'Sáb'},
  {key:'dom',label:'Dom'},
];
const DEFAULT_HOURS = {
  seg:{open:true,start:'08:00',end:'22:00'},ter:{open:true,start:'08:00',end:'22:00'},
  qua:{open:true,start:'08:00',end:'22:00'},qui:{open:true,start:'08:00',end:'22:00'},
  sex:{open:true,start:'08:00',end:'22:00'},sab:{open:true,start:'09:00',end:'20:00'},
  dom:{open:false,start:'09:00',end:'18:00'},
};
const TODAY = new Date().toISOString().split('T')[0];

const TIPO_PLANO_OPTS = [
  {value:'avulso',     label:'Aula Avulsa'},
  {value:'mensal',     label:'Plano Mensal'},
  {value:'trimestral', label:'Plano Trimestral'},
  {value:'semestral',  label:'Plano Semestral'},
];
const RECORRENCIA_OPTS = [
  {value:'nenhuma',   label:'Sem recorrência'},
  {value:'1x_semana', label:'1x por semana'},
  {value:'2x_semana', label:'2x por semana'},
  {value:'3x_semana', label:'3x por semana'},
  {value:'semanal',   label:'Semanal (toda semana)'},
  {value:'quinzenal', label:'Quinzenal (a cada 2 semanas)'},
  {value:'mensal',    label:'Mensal (1x por mês)'},
];
const TIPO_PLANO_LABEL = {avulso:'Avulso',mensal:'Mensal',trimestral:'Trimestral',semestral:'Semestral'};
const RECORRENCIA_LABEL = {nenhuma:'Sem recorrência',semanal:'Semanal',quinzenal:'Quinzenal',mensal:'1x/mês'};

// ================================================================
// UTILITIES
// ================================================================
const fmt$ = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);
const fmtDate = d => { if(!d)return''; const s=(typeof d==='string'?d:d.toISOString()).split('T')[0]; const[y,m,dd]=s.split('-'); return`${dd}/${m}/${y}`; };
const statusLabel = s => ({confirmed:'Confirmada',cancelled:'Cancelada',completed:'Concluída'}[s]||s);
const statusColor = s => ({confirmed:'bg-emerald-100 text-emerald-700',cancelled:'bg-red-100 text-red-700',completed:'bg-gray-100 text-gray-600'}[s]||'bg-gray-100 text-gray-600');
const canModify = r => { const dt=new Date(`${typeof r.date==='string'?r.date:r.date.toISOString().split('T')[0]}T${r.start_time}:00`); return new Date()<new Date(dt.getTime()-2*60*60*1000); };

async function viaCEP(cep) {
  const c=cep.replace(/\D/g,'');
  if(c.length!==8)return null;
  try{const r=await fetch(`https://viacep.com.br/ws/${c}/json/`);const d=await r.json();return d.erro?null:d;}catch{return null;}
}

// Comprime mantendo qualidade visual alta: 1920px max, 92% qualidade JPEG
function compressImage(file,maxW=1920,quality=0.92){
  return new Promise(resolve=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      const scale=Math.min(1,maxW/img.width);
      const canvas=document.createElement('canvas');
      canvas.width=Math.round(img.width*scale);
      canvas.height=Math.round(img.height*scale);
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg',quality));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);resolve(null);};
    img.src=url;
  });
}

// ================================================================
// UI COMPONENTS
// ================================================================
function Toast({toast}){
  if(!toast)return null;
  const bg={success:'bg-emerald-600',error:'bg-red-600',info:'bg-blue-600',warning:'bg-amber-500'}[toast.type]||'bg-gray-700';
  return<div className={`fixed top-4 right-4 z-[100] ${bg} text-white px-5 py-3 rounded-xl shadow-xl text-sm max-w-xs`}>{toast.message}</div>;
}

function Spinner({text='Carregando...'}){
  return<div className="flex flex-col items-center justify-center py-20 text-gray-400"><div className="w-10 h-10 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mb-3"/><p className="text-sm">{text}</p></div>;
}

function Btn({onClick,children,variant='primary',size='md',className='',disabled=false,type='button'}){
  const base='font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 inline-flex items-center justify-center gap-1.5';
  const sz={sm:'px-3 py-1.5 text-xs',md:'px-4 py-2 text-sm',lg:'px-6 py-3 text-base'};
  const vr={primary:'bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-500',secondary:'bg-white border border-gray-300 hover:bg-gray-50 text-gray-700',danger:'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',ghost:'bg-transparent hover:bg-gray-100 text-gray-600',outline:'border border-emerald-600 text-emerald-600 hover:bg-emerald-50',warning:'bg-amber-500 hover:bg-amber-600 text-white focus:ring-amber-400',success:'bg-emerald-500 hover:bg-emerald-600 text-white focus:ring-emerald-400'};
  return<button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sz[size]} ${vr[variant]} ${disabled?'opacity-40 cursor-not-allowed':''} ${className}`}>{children}</button>;
}

function Field({label,required,badge,children,help}){
  return<div>{label&&<label className="block text-sm font-medium text-gray-700 mb-1">{label}{required&&<span className="text-red-500 ml-0.5">*</span>}{badge&&<span className={`ml-2 text-xs px-1.5 py-0.5 rounded font-normal ${badge==='pub'?'bg-blue-100 text-blue-600':'bg-gray-100 text-gray-500'}`}>{badge==='pub'?'🌐 Público':'🔒 Interno'}</span>}</label>}{children}{help&&<p className="text-xs text-gray-400 mt-0.5">{help}</p>}</div>;
}

function Inp({value,onChange,placeholder,type='text',className='',disabled=false,min,max}){
  return<input type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} min={min} max={max} className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white ${disabled?'bg-gray-50 text-gray-400':''} ${className}`}/>;
}

function Sel({value,onChange,options,placeholder}){
  return<select value={value} onChange={onChange} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">{placeholder&&<option value="">{placeholder}</option>}{options.map(o=>{const v=typeof o==='string'?o:o.value;const l=typeof o==='string'?o:o.label;return<option key={v} value={v}>{l}</option>;})}</select>;
}

function Modal({open,onClose,title,children,maxW='max-w-lg'}){
  if(!open)return null;
  return<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/><div className={`relative bg-white rounded-2xl shadow-2xl w-full ${maxW} max-h-[92vh] flex flex-col`}><div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0"><h2 className="font-semibold text-gray-800 text-base">{title}</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100">✕</button></div><div className="p-5 overflow-y-auto">{children}</div></div></div>;
}

function Badge({children,color='gray'}){
  const c={green:'bg-emerald-100 text-emerald-700',red:'bg-red-100 text-red-700',blue:'bg-blue-100 text-blue-700',gray:'bg-gray-100 text-gray-600',yellow:'bg-amber-100 text-amber-700'};
  return<span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c[color]}`}>{children}</span>;
}

function Tabs({tabs,active,onChange}){
  return<div className="border-b border-gray-200 mb-5"><nav className="flex gap-1">{tabs.map(t=><button key={t.key} onClick={()=>onChange(t.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${active===t.key?'border-emerald-600 text-emerald-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label}</button>)}</nav></div>;
}

function HoursEditor({value,onChange}){
  const upd=(day,field,val)=>onChange({...value,[day]:{...value[day],[field]:val}});
  return<div className="space-y-1.5">{DAYS.map(({key,label})=><div key={key} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg"><div className="w-9 text-sm font-medium text-gray-600 shrink-0">{label}</div><label className="flex items-center gap-1.5 cursor-pointer shrink-0"><input type="checkbox" checked={value[key]?.open||false} onChange={e=>upd(key,'open',e.target.checked)} className="w-4 h-4 accent-emerald-600"/><span className="text-xs text-gray-500">Aberto</span></label>{value[key]?.open&&<><input type="time" value={value[key]?.start||'08:00'} onChange={e=>upd(key,'start',e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs w-24"/><span className="text-gray-400 text-xs shrink-0">até</span><input type="time" value={value[key]?.end||'22:00'} onChange={e=>upd(key,'end',e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs w-24"/></>}{!value[key]?.open&&<span className="text-xs text-gray-400 italic">Fechado</span>}</div>)}</div>;
}

// ================================================================
// MARKETPLACE HEADER
// ================================================================
function MktHeader({publicUser,page,navigate,onLogout}){
  return<header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm"><div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between"><div className="flex items-center gap-2.5 cursor-pointer" onClick={()=>navigate('mkt-home')}><div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center shadow-sm"><span className="text-white font-black text-base">P</span></div><div className="hidden sm:block"><p className="font-bold text-gray-800 text-sm leading-tight">P. Soluções</p><p className="text-xs text-gray-400 leading-tight">Esportes &amp; Reservas</p></div></div><nav className="flex items-center gap-2">{publicUser?<><button onClick={()=>navigate('my-reservations')} className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${page==='my-reservations'?'bg-emerald-50 text-emerald-700':'text-gray-600 hover:text-emerald-600'}`}>Minhas Reservas</button><div className="h-5 w-px bg-gray-200"/><div className="text-sm text-gray-700 font-medium">{publicUser.name.split(' ')[0]}</div><Btn variant="ghost" size="sm" onClick={onLogout}>Sair</Btn></>:<><Btn variant="outline" size="sm" onClick={()=>navigate('public-auth','login')}>Entrar</Btn><Btn variant="primary" size="sm" onClick={()=>navigate('public-auth','register')}>Cadastrar</Btn></>}<div className="h-5 w-px bg-gray-200 ml-1"/><Btn variant="ghost" size="sm" onClick={()=>navigate('crm-login')} className="text-gray-400 text-xs">CRM ›</Btn></nav></div></header>;
}

// ================================================================
// MARKETPLACE HOME
// ================================================================
function MktHome({establishments,points,profissionais,navigate}){
  const [search,setSearch]=useState('');
  const [typeF,setTypeF]=useState('');
  const s=search.toLowerCase();
  const filtEst=establishments.filter(e=>{
    if(typeF==='profissional') return false;
    const mT=!typeF||points.some(p=>p.est_id===e.id&&p.type===typeF);
    const mS=!s||e.name.toLowerCase().includes(s)||(e.street||'').toLowerCase().includes(s)||(e.city||'').toLowerCase().includes(s);
    return mT&&mS;
  });
  const filtProf=profissionais.filter(p=>{
    if(typeF&&typeF!=='profissional')return false;
    return !s||p.nome.toLowerCase().includes(s)||(p.especialidade||'').toLowerCase().includes(s)||(p.city||'').toLowerCase().includes(s);
  });
  const total=filtEst.length+filtProf.length;
  return<div><div className="bg-gradient-to-br from-emerald-800 via-emerald-700 to-emerald-600 text-white"><div className="max-w-4xl mx-auto px-4 pt-16 pb-20 text-center"><h1 className="text-4xl sm:text-5xl font-black mb-3 tracking-tight">Reserve seu esporte favorito</h1><p className="text-emerald-200 text-lg mb-10">Quadras, campos, espaços esportivos e profissionais perto de você</p><div className="bg-white rounded-2xl p-4 shadow-2xl"><div className="flex flex-col sm:flex-row gap-3"><div className="flex-1"><Sel value={typeF} onChange={e=>setTypeF(e.target.value)} options={[...ESTABLISHMENT_TYPES,{value:'profissional',label:'👤 Profissional de Ed. Física'}]} placeholder="Tipo de esporte / espaço"/></div><div className="flex-1"><Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome, especialidade ou cidade..."/></div></div></div></div></div><div className="max-w-7xl mx-auto px-4 py-10"><div className="flex items-center justify-between mb-6"><h2 className="text-xl font-semibold text-gray-800">{total} resultado{total!==1?'s':''} encontrado{total!==1?'s':''}</h2>{(search||typeF)&&<button onClick={()=>{setSearch('');setTypeF('');}} className="text-sm text-emerald-600 hover:underline">Limpar filtros</button>}</div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
    {filtEst.map(est=>{const pts=points.filter(p=>p.est_id===est.id);const minP=pts.length?Math.min(...pts.map(p=>p.price_per_hour)):0;const types=[...new Set(pts.map(p=>p.type))];return<div key={`est-${est.id}`} onClick={()=>navigate('est-detail',est.id)} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 card-hover cursor-pointer"><div className="h-48 relative overflow-hidden bg-gray-200">{est.main_photo?<img src={est.main_photo} alt={est.name} className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center text-5xl">🏟️</div>}<div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3"><p className="text-white text-xs font-medium">{est.street}{est.number?`, ${est.number}`:''}</p></div></div><div className="p-4"><h3 className="font-bold text-gray-800 mb-1">{est.name}</h3><p className="text-xs text-gray-500 mb-3">{pts.length} espaço{pts.length!==1?'s':''} • {est.city||''}/{est.state||''}</p><div className="flex items-end justify-between"><div className="flex flex-wrap gap-1">{types.slice(0,2).map(t=><Badge key={t} color="green">{t.replace('Quadra de ','')}</Badge>)}{types.length>2&&<Badge color="gray">+{types.length-2}</Badge>}</div><div className="text-right"><p className="text-xs text-gray-400">a partir de</p><p className="text-emerald-600 font-bold text-sm">{fmt$(minP)}/h</p></div></div></div></div>;})}
    {filtProf.map(p=><div key={`prof-${p.id}`} onClick={()=>navigate('prof-detail',p.id)} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 card-hover cursor-pointer"><div className="h-48 relative overflow-hidden bg-gradient-to-br from-blue-100 to-indigo-100">{p.foto?<img src={p.foto} alt={p.nome} className="w-full h-full object-cover" style={{objectPosition:`${p.foto_x??50}% ${p.foto_y??30}%`}}/>:<div className="w-full h-full flex items-center justify-center text-6xl">🏋️</div>}<div className="absolute top-3 left-3"><span className="bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded-full">👤 Profissional EF</span></div></div><div className="p-4"><h3 className="font-bold text-gray-800 mb-1">{p.nome}</h3><p className="text-xs text-gray-500 mb-3">{p.especialidade||'Ed. Física'} • {p.city||''}{p.state?`/${p.state}`:''}</p><div className="flex items-end justify-between"><div className="flex flex-wrap gap-1">{p.cref&&<Badge color="blue">CREF {p.cref}</Badge>}{p.aceita_avulso&&<Badge color="green">Avulso</Badge>}{p.aceita_mensal&&<Badge color="green">Mensal</Badge>}</div>{p.valor_hora>0&&<div className="text-right"><p className="text-xs text-gray-400">a partir de</p><p className="text-indigo-600 font-bold text-sm">{fmt$(p.valor_hora)}/h</p></div>}</div></div></div>)}
  </div>{total===0&&<div className="text-center py-20"><p className="text-6xl mb-4">🔍</p><p className="text-xl text-gray-500 mb-2">Nenhum resultado encontrado</p></div>}</div></div>;
}

// ================================================================
// ESTABLISHMENT DETAIL
// ================================================================
function EstDetail({estId,points,navigate,publicUser,onReserve}){
  const [est,setEst]=useState(null);
  const [loading,setLoading]=useState(true);
  const [selPt,setSelPt]=useState(null);
  const [selDate,setSelDate]=useState('');
  const [slots,setSlots]=useState([]);
  const [slotsLoading,setSlotsLoading]=useState(false);
  const [selSlots,setSelSlots]=useState([]);
  const [photo,setPhoto]=useState(0);

  useEffect(()=>{
    estApi.get(estId).then(setEst).catch(()=>{}).finally(()=>setLoading(false));
  },[estId]);

  useEffect(()=>{
    if(!selPt||!selDate){setSlots([]);return;}
    setSlotsLoading(true);
    pointApi.slots(selPt.id,selDate).then(setSlots).catch(()=>setSlots([])).finally(()=>setSlotsLoading(false));
    setSelSlots([]);
  },[selPt,selDate]);

  if(loading)return<Spinner/>;
  if(!est)return<div className="p-12 text-center text-gray-400">Estabelecimento não encontrado.</div>;

  const pts=points.filter(p=>p.est_id===est.id);
  const maxDate=new Date(); maxDate.setMonth(maxDate.getMonth()+2);
  const maxDateStr=maxDate.toISOString().split('T')[0];
  const photos=est.photos||[];

  const toggleSlot=(s)=>{
    if(!s.available)return;
    setSelSlots(prev=>{
      const next=prev.includes(s.time)?prev.filter(t=>t!==s.time):[...prev,s.time].sort();
      for(let i=1;i<next.length;i++){ if(parseInt(next[i])-parseInt(next[i-1])!==1)return prev; }
      return next;
    });
  };

  const hours=selSlots.length;
  const total=selPt?hours*selPt.price_per_hour:0;
  const startT=selSlots[0];
  const endT=selSlots.length?`${String(parseInt(selSlots[selSlots.length-1])+1).padStart(2,'0')}:00`:null;
  const canRes=selPt&&selDate&&selSlots.length>0;

  const handleRes=()=>{
    if(!publicUser){onReserve({pt:selPt,est,date:selDate,startT,endT,hours,total},true);return;}
    onReserve({pt:selPt,est,date:selDate,startT,endT,hours,total},false);
  };

  return<div className="max-w-7xl mx-auto px-4 py-8"><button onClick={()=>navigate('mkt-home')} className="text-emerald-600 hover:text-emerald-700 text-sm mb-5 flex items-center gap-1.5 font-medium">← Voltar</button><div className="grid grid-cols-1 lg:grid-cols-3 gap-8"><div className="lg:col-span-2 space-y-6"><div className="relative rounded-2xl overflow-hidden h-72 bg-gray-200">{photos.length?<img src={photos[photo]} alt={est.name} className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center text-7xl">🏟️</div>}{photos.length>1&&<><button onClick={()=>setPhoto(p=>(p-1+photos.length)%photos.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center">‹</button><button onClick={()=>setPhoto(p=>(p+1)%photos.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center">›</button><div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">{photos.map((_,i)=><button key={i} onClick={()=>setPhoto(i)} className={`w-2 h-2 rounded-full ${i===photo?'bg-white':'bg-white/40'}`}/>)}</div></>}</div><div><h1 className="text-2xl font-black text-gray-900 mb-2">{est.name}</h1><p className="text-gray-500 text-sm mb-1">📍 {est.street}{est.number?`, ${est.number}`:''}{est.complement?` — ${est.complement}`:''}</p><p className="text-gray-500 text-sm mb-1">{est.city}/{est.state} — CEP {est.cep}</p><p className="text-gray-500 text-sm mb-1">📞 {est.phone}</p>{est.site&&<a href={est.site} target="_blank" rel="noopener noreferrer" className="text-emerald-600 text-sm hover:underline flex items-center gap-1">🌐 {est.site.replace(/^https?:\/\//,'')}</a>}</div><div className="bg-white rounded-2xl border border-gray-100 p-5"><h3 className="font-bold text-gray-800 mb-3">Horário de Funcionamento</h3><div className="grid grid-cols-2 gap-1">{DAYS.map(({key,label})=><div key={key} className="flex items-center gap-2 text-sm py-0.5"><span className="w-9 text-gray-500 font-medium">{label}:</span>{est.operating_hours?.[key]?.open?<span className="text-gray-700">{est.operating_hours[key].start} – {est.operating_hours[key].end}</span>:<span className="text-gray-400 italic text-xs">Fechado</span>}</div>)}</div></div><div><h3 className="font-bold text-gray-800 mb-3">Espaços disponíveis</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{pts.map(pt=><div key={pt.id} onClick={()=>{setSelPt(pt);setSelSlots([]);}} className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${selPt?.id===pt.id?'border-emerald-500 bg-emerald-50':'border-gray-200 hover:border-emerald-300 bg-white'}`}><div className="flex justify-between items-start"><div><p className="font-semibold text-gray-800">{pt.name}</p><p className="text-xs text-gray-500 mt-0.5">{pt.type}</p></div><span className="text-emerald-600 font-bold text-sm">{fmt$(pt.price_per_hour)}/h</span></div>{pt.custom_hours&&<p className="text-xs text-amber-600 mt-1.5">⏰ Horário próprio</p>}</div>)}</div></div></div><div className="lg:col-span-1"><div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm sticky top-24"><h3 className="font-bold text-gray-800 mb-4 text-base">Fazer uma Reserva</h3>{!selPt?<div className="text-center py-8"><p className="text-4xl mb-2">👈</p><p className="text-sm text-gray-400">Selecione um espaço ao lado</p></div>:<div className="space-y-4"><div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100"><p className="text-sm font-semibold text-emerald-800">{selPt.name}</p><p className="text-xs text-emerald-600">{selPt.type} • {fmt$(selPt.price_per_hour)}/hora</p></div><Field label="Data da reserva" required><Inp type="date" value={selDate} min={TODAY} max={maxDateStr} onChange={e=>{setSelDate(e.target.value);setSelSlots([]);}}/></Field>{selDate&&<div><p className="text-sm font-medium text-gray-700 mb-2">Horários disponíveis</p>{slotsLoading?<Spinner text="Buscando horários..."/>:slots.length===0?<div className="text-center py-4 bg-gray-50 rounded-lg"><p className="text-sm text-gray-400">Nenhum horário disponível</p></div>:<><div className="grid grid-cols-3 gap-1.5">{slots.map(s=><button key={s.time} onClick={()=>toggleSlot(s)} disabled={!s.available} className={`slot-btn py-2 text-xs rounded-lg border font-medium ${selSlots.includes(s.time)?'bg-emerald-600 text-white border-emerald-600':s.available?'border-gray-300 hover:border-emerald-400 text-gray-700':'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed line-through'}`}>{s.time}</button>)}</div><p className="text-xs text-gray-400 mt-1.5">Selecione horários consecutivos</p></>}</div>}{selSlots.length>0&&<div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm"><div className="flex justify-between text-gray-600"><span>Período</span><span className="font-medium">{startT} – {endT}</span></div><div className="flex justify-between text-gray-600"><span>Duração</span><span className="font-medium">{hours}h</span></div><div className="flex justify-between text-emerald-700 font-bold pt-1.5 border-t border-gray-200"><span>Total estimado</span><span>{fmt$(total)}</span></div><p className="text-xs text-gray-400">💳 Pagamento no local</p></div>}<Btn onClick={handleRes} disabled={!canRes} className="w-full" size="lg">{publicUser?'Solicitar Reserva':'Entrar para Reservar'}</Btn></div>}</div></div></div></div>;
}

// ================================================================
// PROFISSIONAL EF DETAIL (Marketplace)
// ================================================================
function ProfDetail({profId,navigate}){
  const [prof,setProf]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    profEfApi.publicGet(profId).then(setProf).catch(()=>setProf(null)).finally(()=>setLoading(false));
  },[profId]);
  if(loading)return<div className="p-8"><Spinner/></div>;
  if(!prof)return<div className="max-w-2xl mx-auto px-4 py-16 text-center"><p className="text-5xl mb-4">😕</p><p className="text-gray-500">Profissional não encontrado.</p><Btn className="mt-4" onClick={()=>navigate('mkt-home')}>← Voltar</Btn></div>;
  const hasHours=prof.operating_hours&&Object.values(prof.operating_hours).some(h=>h?.open);
  return<div className="max-w-4xl mx-auto px-4 py-8">
    <button onClick={()=>navigate('mkt-home')} className="text-indigo-600 hover:text-indigo-700 text-sm mb-5 flex items-center gap-1.5 font-medium">← Voltar</button>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        {/* Foto e identidade */}
        <div className="flex gap-6 items-start">
          <div className="w-32 h-32 rounded-2xl overflow-hidden bg-gradient-to-br from-blue-100 to-indigo-100 shrink-0 shadow-sm">
            {prof.foto?<img src={prof.foto} alt={prof.nome} className="w-full h-full object-cover" style={{objectPosition:`${prof.foto_x??50}% ${prof.foto_y??30}%`}}/>:<div className="w-full h-full flex items-center justify-center text-5xl">🏋️</div>}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1"><span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-0.5 rounded-full">👤 Profissional EF</span>{prof.cref&&<span className="bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5 rounded-full">CREF {prof.cref}</span>}</div>
            <h1 className="text-2xl font-black text-gray-900 mb-1">{prof.nome}</h1>
            {prof.especialidade&&<p className="text-indigo-600 font-semibold text-sm mb-2">{prof.especialidade}</p>}
            {prof.bio&&<p className="text-gray-600 text-sm leading-relaxed">{prof.bio}</p>}
          </div>
        </div>
        {/* Contato e localização */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-2">
          <h3 className="font-bold text-gray-800 mb-3">Contato & Localização</h3>
          {prof.city&&<p className="text-gray-500 text-sm">📍 {prof.street&&`${prof.street}${prof.number?`, ${prof.number}`:''}  — `}{prof.city}{prof.state?`/${prof.state}`:''}{prof.cep?` — CEP ${prof.cep}`:''}</p>}
          {prof.phone&&<p className="text-gray-500 text-sm">📞 {prof.phone}</p>}
          {prof.email&&<a href={`mailto:${prof.email}`} className="text-indigo-600 text-sm hover:underline flex items-center gap-1">✉️ {prof.email}</a>}
          {prof.site&&<a href={prof.site} target="_blank" rel="noopener noreferrer" className="text-indigo-600 text-sm hover:underline flex items-center gap-1">🌐 {prof.site.replace(/^https?:\/\//,'')}</a>}
        </div>
        {/* Horário */}
        {hasHours&&<div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="font-bold text-gray-800 mb-3">Disponibilidade</h3>
          <div className="grid grid-cols-2 gap-1">{DAYS.map(({key,label})=><div key={key} className="flex items-center gap-2 text-sm py-0.5"><span className="w-9 text-gray-500 font-medium">{label}:</span>{prof.operating_hours?.[key]?.open?<span className="text-gray-700">{prof.operating_hours[key].start} – {prof.operating_hours[key].end}</span>:<span className="text-gray-400 italic text-xs">Indisponível</span>}</div>)}</div>
        </div>}
      </div>
      {/* Card lateral */}
      <div className="lg:col-span-1">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm sticky top-24 space-y-4">
          <h3 className="font-bold text-gray-800 text-base">Atendimento</h3>
          <div className="space-y-2">
            {prof.aceita_avulso&&<div className="flex items-center gap-2 text-sm text-gray-700 bg-green-50 rounded-xl px-3 py-2">✅ Aulas avulsas</div>}
            {prof.aceita_mensal&&<div className="flex items-center gap-2 text-sm text-gray-700 bg-green-50 rounded-xl px-3 py-2">✅ Planos mensais</div>}
            {prof.valor_hora>0&&<div className="mt-2 pt-3 border-t border-gray-100"><p className="text-xs text-gray-400">Valor hora</p><p className="text-2xl font-black text-indigo-700">{fmt$(prof.valor_hora)}<span className="text-sm font-normal text-gray-400">/h</span></p></div>}
          </div>
          {prof.phone&&<a href={`https://wa.me/55${prof.phone.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" className="block w-full text-center bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors">💬 Falar no WhatsApp</a>}
          {prof.email&&<a href={`mailto:${prof.email}`} className="block w-full text-center border border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-semibold rounded-xl py-2.5 text-sm transition-colors">✉️ Enviar Email</a>}
        </div>
      </div>
    </div>
  </div>;
}

// ================================================================
// AUTH MODAL
// ================================================================
function AuthModal({open,onClose,onLogin,onRegister,initialMode='login'}){
  const [mode,setMode]=useState(initialMode);
  const [f,setF]=useState({name:'',cpf:'',email:'',pw:'',pw2:''});
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(false);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  useEffect(()=>{setMode(initialMode);setErr('');},[initialMode,open]);

  const handleLogin=async()=>{
    if(!f.email||!f.pw){setErr('Preencha email e senha');return;}
    setLoading(true);
    try{await onLogin(f.email,f.pw);}catch(e){setErr(e.message);}finally{setLoading(false);}
  };
  const handleReg=async()=>{
    if(!f.name||!f.cpf||!f.email||!f.pw||!f.pw2){setErr('Preencha todos os campos');return;}
    if(f.pw!==f.pw2){setErr('As senhas não coincidem');return;}
    if(f.pw.length<6){setErr('Senha deve ter ao menos 6 caracteres');return;}
    setLoading(true);
    try{await onRegister(f.name,f.cpf,f.email,f.pw);}catch(e){setErr(e.message);}finally{setLoading(false);}
  };

  return<Modal open={open} onClose={onClose} title={mode==='login'?'Entrar na sua conta':'Criar conta gratuita'}><div><div className="flex border border-gray-200 rounded-xl overflow-hidden mb-5"><button onClick={()=>{setMode('login');setErr('');}} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${mode==='login'?'bg-emerald-600 text-white':'text-gray-600 hover:bg-gray-50'}`}>Já tenho conta</button><button onClick={()=>{setMode('register');setErr('');}} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${mode==='register'?'bg-emerald-600 text-white':'text-gray-600 hover:bg-gray-50'}`}>Criar conta</button></div><div className="space-y-3">{mode==='register'&&<><Field label="Nome completo" required><Inp value={f.name} onChange={e=>upd('name',e.target.value)}/></Field><Field label="CPF" required><Inp value={f.cpf} onChange={e=>upd('cpf',e.target.value)} placeholder="000.000.000-00"/></Field></>}<Field label="Email" required><Inp type="email" value={f.email} onChange={e=>upd('email',e.target.value)}/></Field><Field label="Senha" required><Inp type="password" value={f.pw} onChange={e=>upd('pw',e.target.value)}/></Field>{mode==='register'&&<Field label="Confirmar senha" required><Inp type="password" value={f.pw2} onChange={e=>upd('pw2',e.target.value)}/></Field>}{err&&<p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{err}</p>}<Btn onClick={mode==='login'?handleLogin:handleReg} className="w-full" size="lg" disabled={loading}>{loading?'Aguarde...':mode==='login'?'Entrar':'Criar conta'}</Btn>{mode==='login'&&<button onClick={()=>onClose('forgot')} className="text-xs text-emerald-600 hover:underline w-full text-center mt-1">Esqueci minha senha</button>}</div></div></Modal>;
}

// ================================================================
// RESERVATION CONFIRM MODAL
// ================================================================
const PAY_OPTS=[{value:'pix',label:'💠 Pix'},{value:'credito',label:'💳 Crédito'},{value:'debito',label:'🏦 Débito'},{value:'dinheiro',label:'💵 Dinheiro'}];

function ResConfirmModal({open,data:rd,publicUser,onConfirm,onClose,loading}){
  const [pm,setPm]=useState('pix');
  if(!rd)return null;
  const{pt,est,date,startT,endT,hours,total}=rd;
  return<Modal open={open} onClose={onClose} title="Confirmar Reserva"><div className="space-y-4">
    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-2 text-sm">
      {[['Estabelecimento',est.name],['Espaço',pt.name],['Tipo',pt.type],['Data',fmtDate(date)],['Horário',`${startT} – ${endT}`],['Duração',`${hours}h`]].map(([k,v])=><div key={k} className="flex justify-between"><span className="text-gray-500">{k}</span><span className="font-medium text-gray-800">{v}</span></div>)}
      <div className="flex justify-between text-emerald-700 font-bold border-t border-emerald-200 pt-2 mt-1"><span>Valor total</span><span>{fmt$(total)}</span></div>
    </div>
    <Field label="Forma de pagamento" required>
      <Sel value={pm} onChange={e=>setPm(e.target.value)} options={PAY_OPTS}/>
    </Field>
    <div className="text-xs text-gray-500 space-y-1"><p>💳 Pagamento exclusivamente no local do estabelecimento.</p><p>📧 Confirmação será enviada para <strong>{publicUser?.email}</strong></p></div>
    <div className="flex gap-3"><Btn variant="secondary" onClick={onClose} className="flex-1">Cancelar</Btn><Btn onClick={()=>onConfirm(pm)} className="flex-1" disabled={loading}>{loading?'Confirmando...':'✅ Confirmar Reserva'}</Btn></div>
  </div></Modal>;
}

// ================================================================
// MY RESERVATIONS
// ================================================================
function MyReservations({publicUser,navigate,showToast}){
  const [reservations,setReservations]=useState([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState('upcoming');
  const [reschRes,setReschRes]=useState(null);
  const [newDate,setNewDate]=useState('');
  const [newSlots,setNewSlots]=useState([]);
  const [rSlots,setRSlots]=useState([]);
  const [rSlotsLoading,setRSlotsLoading]=useState(false);

  const load=useCallback(()=>{
    setLoading(true);
    resApi.list().then(setReservations).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{load();},[load]);

  useEffect(()=>{
    if(!reschRes||!newDate)return;
    setRSlotsLoading(true);
    pointApi.slots(reschRes.point_id,newDate).then(setRSlots).catch(()=>setRSlots([])).finally(()=>setRSlotsLoading(false));
    setNewSlots([]);
  },[reschRes,newDate]);

  const now=new Date();
  const resDateTime=(r)=>{const d=typeof r.date==='string'?r.date.split('T')[0]:r.date.toISOString().split('T')[0];return new Date(`${d}T${(r.end_time||'23:59').slice(0,5)}`);}
  const upcoming=reservations.filter(r=>r.status==='confirmed'&&resDateTime(r)>now);
  const past=reservations.filter(r=>r.status!=='confirmed'||resDateTime(r)<=now);

  const handleCancel=async(id)=>{
    try{await resApi.cancel(id);showToast('Reserva cancelada. Email enviado.','info');load();}
    catch(e){showToast(e.message,'error');}
  };
  const handleDelete=async(id)=>{
    if(!window.confirm('Excluir esta reserva permanentemente?'))return;
    try{await resApi.remove(id);showToast('Reserva excluída','info');load();}
    catch(e){showToast(e.message,'error');}
  };

  const toggleRSlot=(s)=>{
    if(!s.available)return;
    setNewSlots(prev=>{
      const next=prev.includes(s.time)?prev.filter(t=>t!==s.time):[...prev,s.time].sort();
      for(let i=1;i<next.length;i++){if(parseInt(next[i].split(':')[0])-parseInt(next[i-1].split(':')[0])!==1)return prev;}
      return next;
    });
  };

  const handleReschedule=async()=>{
    const ns=newSlots[0];
    const ne=`${String(parseInt(newSlots[newSlots.length-1].split(':')[0])+1).padStart(2,'0')}:00`;
    try{await resApi.reschedule(reschRes.id,newDate,ns,ne,newSlots.length);showToast('Reserva remarcada! Email enviado.','success');setReschRes(null);load();}
    catch(e){showToast(e.message,'error');}
  };

  const dateStr=r=>typeof r.date==='string'?r.date:r.date.toISOString().split('T')[0];

  const card=(r)=>{
    const ok=canModify(r)&&r.status==='confirmed';
    return<div key={r.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm"><div className="flex items-start justify-between mb-3"><div><h3 className="font-bold text-gray-800">{r.est_name}</h3><p className="text-sm text-gray-500">{r.point_name} • {r.type}</p></div><span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(r.status)}`}>{statusLabel(r.status)}</span></div><div className="text-sm text-gray-600 space-y-0.5 mb-3"><p>📅 {fmtDate(dateStr(r))} • {r.start_time} – {r.end_time} ({r.hours}h)</p><p>💰 {fmt$(r.total)} — pagamento no local</p></div>{r.status==='confirmed'&&<div className="flex gap-2 items-center"><Btn variant="secondary" size="sm" disabled={!ok} onClick={()=>{setReschRes(r);setNewDate('');setNewSlots([]);}}>Remarcar</Btn><Btn variant="danger" size="sm" disabled={!ok} onClick={()=>handleCancel(r.id)}>Cancelar</Btn>{!ok&&<span className="text-xs text-gray-400">(Prazo encerrado)</span>}</div>}</div>;
  };

  if(loading)return<Spinner/>;

  return<div className="max-w-3xl mx-auto px-4 py-8"><h1 className="text-2xl font-black text-gray-900 mb-6">Minhas Reservas</h1><Tabs tabs={[{key:'upcoming',label:`Próximas (${upcoming.length})`},{key:'past',label:`Histórico (${past.length})`}]} active={tab} onChange={setTab}/><div className="space-y-3">{(tab==='upcoming'?upcoming:past).map(card)}{(tab==='upcoming'?upcoming:past).length===0&&<div className="text-center py-16"><p className="text-5xl mb-3">📅</p><p className="text-gray-500">{tab==='upcoming'?'Nenhuma reserva futura':'Sem histórico'}</p>{tab==='upcoming'&&<Btn className="mt-4" onClick={()=>navigate('mkt-home')}>Fazer uma Reserva</Btn>}</div>}</div><Modal open={!!reschRes} onClose={()=>setReschRes(null)} title="Remarcar Reserva">{reschRes&&<div className="space-y-4"><div className="bg-gray-50 rounded-xl p-3 text-sm"><p className="font-medium text-gray-700">{reschRes.point_name}</p><p className="text-gray-500">Atual: {fmtDate(dateStr(reschRes))} • {reschRes.start_time} – {reschRes.end_time}</p></div><Field label="Nova data" required><Inp type="date" value={newDate} min={TODAY} onChange={e=>{setNewDate(e.target.value);setNewSlots([]);}}/></Field>{newDate&&<div><p className="text-sm font-medium text-gray-700 mb-2">Novo horário</p>{rSlotsLoading?<Spinner text="Buscando..."/>:rSlots.length===0?<p className="text-sm text-gray-400 text-center py-3">Nenhum horário disponível</p>:<div className="grid grid-cols-4 gap-1.5">{rSlots.map(s=><button key={s.time} onClick={()=>toggleRSlot(s)} disabled={!s.available} className={`py-2 text-xs rounded-lg border font-medium ${newSlots.includes(s.time)?'bg-emerald-600 text-white border-emerald-600':s.available?'border-gray-300 hover:border-emerald-400 text-gray-700':'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'}`}>{s.time}</button>)}</div>}</div>}<div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setReschRes(null)}>Cancelar</Btn><Btn className="flex-1" disabled={!newDate||!newSlots.length} onClick={handleReschedule}>Confirmar Remarcação</Btn></div></div>}</Modal></div>;
}

// ================================================================
// PASSWORD RECOVERY
// ================================================================
function PasswordRecovery({navigate,type='public'}){
  const [step,setStep]=useState(1);
  const [email,setEmail]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const send=async()=>{
    setLoading(true);setError('');
    try{await authApi.forgotPassword(email,type);setStep(2);}
    catch(e){setError(e.message||'Erro ao enviar email. Tente novamente em alguns minutos.');}
    finally{setLoading(false);}
  };
  return<div className="min-h-screen bg-gray-100 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm"><div className="text-center mb-6"><div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">🔑</span></div><h1 className="text-xl font-bold text-gray-800">Recuperar Senha</h1></div>{step===1?<div className="space-y-4"><p className="text-sm text-gray-500 text-center">Informe seu email cadastrado.</p><Field label="Email"><Inp type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field>{error&&<div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}<Btn className="w-full" onClick={send} disabled={!email||loading}>{loading?'Enviando...':'Enviar Link'}</Btn></div>:<div className="text-center space-y-3"><p className="text-5xl">📬</p><p className="text-sm text-gray-700 font-medium">Email enviado!</p><p className="text-xs text-gray-500">Link enviado para <strong>{email}</strong>. Expira em 30 minutos.</p></div>}<button onClick={()=>navigate(type==='crm'?'crm-login':'mkt-home')} className="text-sm text-emerald-600 hover:underline mt-5 block text-center w-full">{type==='crm'?'← Voltar ao CRM':'← Voltar ao início'}</button></div></div>;
}

// ================================================================
// RESET DE SENHA (link do email)
// ================================================================
function ResetPassword({token,type='public',navigate,showToast}){
  const [pw,setPw]=useState('');
  const [pw2,setPw2]=useState('');
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const match=pw&&pw2&&pw===pw2;
  const handle=async()=>{
    if(!match)return;
    if(pw.length<6){showToast('Senha deve ter ao menos 6 caracteres','error');return;}
    setLoading(true);
    try{
      await authApi.resetPassword(token,pw,type);
      setDone(true);
    }catch(e){showToast(e.message||'Token inválido ou expirado','error');}finally{setLoading(false);}
  };
  return<div className="min-h-screen bg-gray-100 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm"><div className="text-center mb-6"><div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">🔑</span></div><h1 className="text-xl font-bold text-gray-800">Nova Senha</h1><p className="text-xs text-gray-400 mt-1">{type==='crm'?'Conta CRM':'Conta Marketplace'}</p></div>{done?<div className="text-center space-y-3"><p className="text-5xl">✅</p><p className="text-sm font-semibold text-gray-800">Senha redefinida com sucesso!</p><Btn className="w-full mt-4" onClick={()=>navigate(type==='crm'?'crm-login':'mkt-home')}>{type==='crm'?'Ir para o CRM':'Ir para o Marketplace'}</Btn></div>:<div className="space-y-4"><Field label="Nova senha" required><Inp type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Mínimo 6 caracteres"/></Field><Field label="Confirmar senha" required><Inp type="password" value={pw2} onChange={e=>setPw2(e.target.value)}/></Field>{pw&&pw2&&!match&&<p className="text-xs text-red-500">As senhas não coincidem</p>}<Btn className="w-full" onClick={handle} disabled={!match||loading}>{loading?'Salvando...':'Salvar Nova Senha'}</Btn></div>}</div></div>;
}

// ================================================================
// CRM LOGIN
// ================================================================
function CRMLogin({onLogin,navigate}){
  const [email,setEmail]=useState('');
  const [pw,setPw]=useState('');
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(false);
  const handle=async()=>{
    setLoading(true);setErr('');
    try{await onLogin(email,pw);}catch(e){setErr(e.message);}finally{setLoading(false);}
  };
  return<div className="min-h-screen bg-gray-900 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm"><div className="text-center mb-7"><div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg"><span className="text-white font-black text-2xl">P</span></div><h1 className="text-xl font-black text-gray-800">P. Soluções</h1><p className="text-sm text-gray-400">Sistema de Gestão — CRM</p></div><div className="space-y-3"><Field label="Email"><Inp type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Senha"><Inp type="password" value={pw} onChange={e=>setPw(e.target.value)}/></Field>{err&&<p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{err}</p>}<Btn className="w-full" size="lg" onClick={handle} disabled={loading}>{loading?'Entrando...':'Entrar no CRM'}</Btn><button onClick={()=>navigate('password-recovery','crm')} className="text-xs text-emerald-600 hover:underline w-full text-center">Esqueci minha senha</button></div><div className="text-center mt-4"><button onClick={()=>navigate('mkt-home')} className="text-xs text-gray-400 hover:text-gray-600">← Voltar ao Marketplace</button></div></div></div>;
}

// ================================================================
// CRM LAYOUT
// ================================================================
function CRMLayout({crmUser,page,navigate,onLogout,isImpersonating,onStopImpersonating,onImpersonate,children}){
  // ── WhatsApp alert ───────────────────────────────────────────────────────
  const [waAlert,setWaAlert]=useState(null); // null | {count:N}
  const isAdminOrManager=['admin','manager'].includes(crmUser?.role);
  useEffect(()=>{
    if(!isAdminOrManager)return;
    whatsappApi.alert().then(d=>{if(d.hasAlert)setWaAlert({count:d.count});}).catch(()=>{});
    const t=setInterval(()=>{
      whatsappApi.alert().then(d=>{setWaAlert(d.hasAlert?{count:d.count}:null);}).catch(()=>{});
    },5*60*1000); // check every 5 min
    return()=>clearInterval(t);
  },[isAdminOrManager]);
  const ackAlert=async()=>{
    await whatsappApi.ackAlert().catch(()=>{});
    setWaAlert(null);
  };
  const groups=[
    {label:'Principal', items:[
      {key:'crm-dashboard',      label:'Dashboard', icon:'📊',roles:['admin','manager']},
      {key:'crm-reservations',   label:'Reservas',  icon:'📅',roles:['admin','manager','simples'],feature:'reservas'},
    ]},
    {label:'Cadastros', items:[
      {key:'crm-establishment',  label:'Estabelecimentos', icon:'🏢',roles:['admin','manager']},
      {key:'crm-points',         label:'Pontos',           icon:'📍',roles:['admin','manager']},
      {key:'crm-professors',     label:'Professores',      icon:'🎓',roles:['admin','manager']},
      {key:'crm-profissionais-ef',label:'Profissionais EF',icon:'🏋️',roles:['admin','manager']},
      {key:'crm-alunos',         label:'Alunos / Clientes', icon:'🎽',roles:['admin','manager','simples','professor','recepcao'],feature:'alunos'},
    ]},
    {label:'Financeiro', items:[
      {key:'crm-financeiro',     label:'Financeiro',   icon:'💰',roles:['admin','manager','simples','professor','recepcao'],feature:'financeiro'},
      {key:'crm-horarios-livres', label:'Horários Livres', icon:'🟢',roles:['admin','manager','simples','professor','recepcao'],feature:'horarios_livres'},
      {key:'crm-funcionarios',   label:'Funcionários', icon:'👷',roles:['admin','manager','simples','professor','recepcao'],feature:'funcionarios'},
      {key:'crm-estoque',        label:'Estoque Bar',  icon:'📦',roles:['admin','manager','simples','professor','recepcao'],feature:'bar'},
    ]},
    {label:'Marketing', items:[
      {key:'crm-unimidia',       label:'Quero Divulgar', icon:'📺',roles:['admin','manager','simples','professor','recepcao'],feature:'unimidia'},
    ]},
    {label:'Administração', items:[
      {key:'crm-users',          label:'Usuários',  icon:'👥',roles:['admin','manager']},
      {key:'crm-audit',          label:'Auditoria', icon:'🛡️',roles:['admin']},
      {key:'crm-entitlements',    label:'Entitlements', icon:'🔐',roles:['admin']},
      {key:'crm-user-profiles',   label:'Perfis',       icon:'🧑‍💼',roles:['admin','manager']},
      {key:'crm-whatsapp',       label:'WhatsApp',  icon:'💬',roles:['admin','manager','simples','professor','recepcao'],feature:'whatsapp'},
    ]},
    {label:'Profissional', items:[
      {key:'prof-perfil',        label:'Meu Perfil',  icon:'👤',roles:['profissional']},
      {key:'prof-alunos',        label:'Meus Alunos', icon:'📚',roles:['profissional']},
    ]},
  ].map(g=>({...g,items:g.items.filter(m=>{
    if(crmUser.role==='admin') return true;
    if(!m.roles.includes(crmUser.role)) return false;
    // Establishment entitlements — feature must be enabled for the est
    if(m.feature&&crmUser.estFeatures&&crmUser.estFeatures[m.feature]===false) return false;
    if(!m.feature) return true; // non-feature pages: role check is enough
    // User-level permissions override (null = use role defaults)
    if(crmUser.permissions) return crmUser.permissions[m.feature]===true;
    // Fall back to role defaults
    return ROLE_DFLT[crmUser.role]?.[m.feature]!==false;
  })})).filter(g=>g.items.length);
  const [openGroups,setOpenGroups]=useState({});
  const isOpen=(l)=>openGroups[l]===true; // recolhido por padrão
  const toggleGroup=(l)=>setOpenGroups(p=>({...p,[l]:!p[l]}));
  const roleLabel={admin:'Administrador',manager:'Gerente',simples:'Usuário Simples',profissional:'Profissional EF',professor:'Professor',recepcao:'Recepção'};
  const [userList,setUserList]=useState([]);
  const [dropOpen,setDropOpen]=useState(false);
  const [mobileOpen,setMobileOpen]=useState(false);
  const isRealAdmin=crmUser.role==='admin'&&!isImpersonating;
  useEffect(()=>{if(!isRealAdmin)return;impersonateApi.listUsers().then(setUserList).catch(()=>{});},[isRealAdmin]);
  return<div className="min-h-screen bg-gray-100 flex flex-col">
    {waAlert&&<div className="bg-red-500 text-white px-4 py-2 flex items-center justify-between text-sm font-semibold shrink-0">
      <span>⚠️ {waAlert.count} mensagem{waAlert.count!==1?'s':''} WhatsApp falhou{waAlert.count!==1?'ram':''} nas últimas 48h. <button onClick={()=>navigate('crm-whatsapp')} className="underline font-bold">Ver histórico</button></span>
      <button onClick={ackAlert} className="ml-4 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-bold">✕ Dispensar</button>
    </div>}
    {isImpersonating&&<div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm font-medium shrink-0">
      <span>Visualizando como <strong>{crmUser.name}</strong></span>
      <button onClick={onStopImpersonating} className="ml-4 bg-white text-amber-700 px-3 py-1 rounded-lg text-xs font-bold hover:bg-amber-50">← Voltar ao Admin</button>
    </div>}
    <div className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2"><div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center"><span className="text-white font-black text-sm">P</span></div><div><p className="text-xs font-black text-gray-800 leading-tight">P. Soluções</p><p className="text-xs text-gray-400 leading-tight">CRM</p></div></div>
      <button onClick={()=>setMobileOpen(true)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 text-xl leading-none">☰</button>
    </div>
    {mobileOpen&&<div className="fixed inset-0 z-50 md:hidden flex">
      <div className="fixed inset-0 bg-black/50" onClick={()=>setMobileOpen(false)}/>
      <aside className="relative w-72 bg-white flex flex-col h-full shadow-2xl overflow-y-auto">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between"><div className="flex items-center gap-2.5"><div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center"><span className="text-white font-black">P</span></div><div><p className="text-xs font-black text-gray-800 leading-tight">P. Soluções</p><p className="text-xs text-gray-400 leading-tight">CRM</p></div></div><button onClick={()=>setMobileOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 text-lg">✕</button></div>
        <nav className="flex-1 p-3 space-y-2 overflow-y-auto">{groups.map(g=><div key={g.label}><button onClick={()=>toggleGroup(g.label)} className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide hover:text-gray-600"><span>{g.label}</span><span className="text-gray-300 text-[10px]">{isOpen(g.label)?'▾':'▸'}</span></button>{isOpen(g.label)&&<div className="space-y-0.5 mt-0.5">{g.items.map(m=><button key={m.key} onClick={()=>{navigate(m.key);setMobileOpen(false);}} className={`sidebar-item w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium ${page===m.key?'bg-emerald-50 text-emerald-700':'text-gray-600 hover:bg-gray-50'}`}><span className="text-base">{m.icon}</span>{m.label}</button>)}</div>}</div>)}</nav>
        <div className="p-3 border-t border-gray-100 space-y-2"><div className="px-3 py-2"><p className="text-xs font-semibold text-gray-700 truncate">{crmUser.name}</p><p className="text-xs text-gray-400">{roleLabel[crmUser.role]||crmUser.role}</p></div><Btn variant="ghost" size="sm" onClick={()=>{onLogout();setMobileOpen(false);}} className="w-full text-gray-500">Sair do CRM</Btn></div>
      </aside>
    </div>}
    <div className="flex flex-1 min-h-0"><aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0"><div className="p-4 border-b border-gray-100"><div className="flex items-center gap-2.5"><div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center"><span className="text-white font-black">P</span></div><div><p className="text-xs font-black text-gray-800 leading-tight">P. Soluções</p><p className="text-xs text-gray-400 leading-tight">CRM</p></div></div></div><nav className="flex-1 p-3 space-y-2 overflow-y-auto">{groups.map(g=><div key={g.label}><button onClick={()=>toggleGroup(g.label)} className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide hover:text-gray-600"><span>{g.label}</span><span className="text-gray-300 text-[10px]">{isOpen(g.label)?'▾':'▸'}</span></button>{isOpen(g.label)&&<div className="space-y-0.5 mt-0.5">{g.items.map(m=><button key={m.key} onClick={()=>navigate(m.key)} className={`sidebar-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium ${page===m.key?'bg-emerald-50 text-emerald-700':'text-gray-600 hover:bg-gray-50'}`}><span className="text-base">{m.icon}</span>{m.label}</button>)}</div>}</div>)}</nav><div className="p-3 border-t border-gray-100 space-y-2">
      {isRealAdmin&&<div><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1 mb-1">Entrar como cliente</p><div className="relative"><button onClick={()=>setDropOpen(p=>!p)} className="w-full flex items-center justify-between px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl hover:border-emerald-400 transition-colors"><span className="text-gray-500 truncate">Selecionar usuário…</span><span className="text-gray-400 ml-1">{dropOpen?'▴':'▾'}</span></button>{dropOpen&&userList.length>0&&<div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto">{userList.map(u=><button key={u.id} onClick={()=>{setDropOpen(false);onImpersonate(u.id);}} className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 transition-colors border-b border-gray-50 last:border-0"><p className="text-xs font-semibold text-gray-800 truncate">{u.name}</p><p className="text-[10px] text-gray-400 truncate">{u.est_name||u.role}</p></button>)}</div>}</div></div>}
      <div className="px-3 py-2"><p className="text-xs font-semibold text-gray-700 truncate">{crmUser.name}</p><p className="text-xs text-gray-400">{roleLabel[crmUser.role]||crmUser.role}</p></div><Btn variant="ghost" size="sm" onClick={onLogout} className="w-full text-gray-500">Sair do CRM</Btn></div></aside><main className="flex-1 overflow-auto">{children}</main></div></div>;
}

// ================================================================
// CRM DASHBOARD
// ================================================================
const PAY_LABEL={'pix':'Pix','credito':'Crédito','debito':'Débito','dinheiro':'Dinheiro'};
const PAY_ICON={'pix':'💠','credito':'💳','debito':'🏦','dinheiro':'💵'};

function DashTable({rows,cols,emptyMsg}){
  if(!rows||rows.length===0)return<div className="text-center py-10 text-gray-400"><p className="text-3xl mb-2">📭</p><p className="text-sm">{emptyMsg||'Sem dados'}</p></div>;
  const totCount=rows.reduce((a,r)=>a+Number(r.count),0);
  const totVal=rows.reduce((a,r)=>a+Number(r.total),0);
  return<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-gray-100">{cols.map(c=><th key={c.key} className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide ${c.right?'text-right':'text-left'}`}>{c.label}</th>)}</tr></thead><tbody className="divide-y divide-gray-50">{rows.map((r,i)=><tr key={i} className="hover:bg-gray-50">{cols.map(c=><td key={c.key} className={`px-3 py-2.5 ${c.right?'text-right font-medium':''} ${c.bold?'font-semibold text-gray-800':'text-gray-600'}`}>{c.fmt?c.fmt(r[c.key]):r[c.key]}</td>)}</tr>)}</tbody><tfoot><tr className="border-t-2 border-gray-200 bg-gray-50"><td colSpan={cols.length-2} className="px-3 py-2 text-xs font-bold text-gray-500 uppercase">Total</td><td className="px-3 py-2 text-right font-bold text-gray-800">{totCount}</td><td className="px-3 py-2 text-right font-bold text-emerald-700">{fmt$(totVal)}</td></tr></tfoot></table></div>;
}

function CRMDashboard(){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState('today');
  const [selDate,setSelDate]=useState(TODAY);
  const [selMonth,setSelMonth]=useState(TODAY.slice(0,7));
  const [clienteSearch,setClienteSearch]=useState('');
  const [clienteQuery,setClienteQuery]=useState('');
  const [clienteData,setClienteData]=useState(null);
  const [clienteLoading,setClienteLoading]=useState(false);

  const loadData=()=>{
    setLoading(true);
    dashboardApi.get({date:selDate,month:selMonth}).then(setData).catch(()=>{}).finally(()=>setLoading(false));
  };

  useEffect(()=>{loadData();},[selDate,selMonth]);

  const buscarCliente=async()=>{
    if(!clienteSearch.trim())return;
    setClienteLoading(true);setClienteQuery(clienteSearch);setClienteData(null);
    try{const d=await dashClienteApi.get(clienteSearch.trim());setClienteData(d);}
    catch(e){alert('Erro ao buscar cliente');}
    finally{setClienteLoading(false);}
  };

  const exportPDF=()=>{
    const el=document.getElementById('cliente-pdf-area');
    if(!el)return;
    const win=window.open('','_blank');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Resumo — ${clienteQuery}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;color:#111;max-width:900px;margin:auto;}
      h1{color:#059669;margin-bottom:4px;}
      h2{color:#374151;font-size:16px;margin:24px 0 8px;}
      .badge{display:inline-block;background:#d1fae5;color:#065f46;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;margin-left:8px;}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;}
      th{background:#f0fdf4;color:#065f46;text-align:left;padding:6px 10px;border-bottom:2px solid #d1fae5;}
      td{padding:6px 10px;border-bottom:1px solid #f3f4f6;}
      .total-box{background:#f0fdf4;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:24px;}
      .total-box span{color:#059669;font-size:22px;font-weight:900;}
      .sub{display:flex;gap:24px;flex-wrap:wrap;margin-top:8px;}
      .sub div{background:#fff;border:1px solid #d1fae5;border-radius:8px;padding:8px 16px;text-align:center;}
      .sub div p{margin:0;font-size:12px;color:#6b7280;}
      .sub div strong{font-size:15px;color:#059669;}
      .footer{margin-top:32px;font-size:11px;color:#9ca3af;text-align:center;}
    </style></head><body>${el.innerHTML}
    <p class="footer">P. Soluções Esportes & Reservas · pesportes.ia.br · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
    </body></html>`);
    win.document.close();
    setTimeout(()=>{win.print();},400);
  };

  const month=selMonth.split('-');
  const monthLabel=`${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][Number(month[1])-1]}/${month[0]}`;

  const pointCols=[
    {key:'est_name',  label:'Estabelecimento', bold:true},
    {key:'point_name',label:'Ponto',bold:true},
    {key:'count',     label:'Reservas',right:true},
    {key:'total',     label:'Valor',right:true,fmt:fmt$},
  ];
  const payCols=[
    {key:'payment_method',label:'Forma de Pagamento',bold:true,fmt:v=>`${PAY_ICON[v]||'💰'} ${PAY_LABEL[v]||v}`},
    {key:'count',label:'Reservas',right:true},
    {key:'total',label:'Valor',right:true,fmt:fmt$},
  ];

  const todayTotal=data?.today?.reduce((a,r)=>a+Number(r.total),0)||0;
  const todayCount=data?.today?.reduce((a,r)=>a+Number(r.count),0)||0;
  const monthTotal=data?.monthByPoint?.reduce((a,r)=>a+Number(r.total),0)||0;
  const monthCount=data?.monthByPoint?.reduce((a,r)=>a+Number(r.count),0)||0;

  return<div className="p-6 max-w-5xl"><h1 className="text-2xl font-black text-gray-900 mb-2">Dashboard</h1>

    {/* Filtros de data */}
    <div className="flex flex-wrap gap-4 mb-6 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Dia</label>
        <input type="date" value={selDate} onChange={e=>setSelDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Mês</label>
        <input type="month" value={selMonth} onChange={e=>setSelMonth(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
      </div>
      {(selDate!==TODAY||selMonth!==TODAY.slice(0,7))&&<button onClick={()=>{setSelDate(TODAY);setSelMonth(TODAY.slice(0,7));}} className="text-xs text-emerald-600 hover:underline font-medium self-end pb-2">↩ Hoje</button>}
      {loading&&<span className="text-xs text-gray-400 self-end pb-2">Atualizando...</span>}
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">{[
      {label:`Reservas em ${fmtDate(selDate)}`,value:todayCount,icon:'📅',color:'bg-emerald-50'},
      {label:`Faturamento em ${fmtDate(selDate)}`,value:fmt$(todayTotal),icon:'💰',color:'bg-blue-50'},
      {label:`Reservas em ${monthLabel}`,value:monthCount,icon:'📆',color:'bg-amber-50'},
      {label:`Faturamento ${monthLabel}`,value:fmt$(monthTotal),icon:'📈',color:'bg-purple-50'},
    ].map(c=><div key={c.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm"><div className="flex items-start gap-3"><div className={`w-10 h-10 ${c.color} rounded-xl flex items-center justify-center text-xl shrink-0`}>{c.icon}</div><div className="min-w-0"><p className="text-xs text-gray-400 mb-0.5 leading-tight">{c.label}</p><p className="text-lg font-black text-gray-800 truncate">{c.value}</p></div></div></div>)}</div>

    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
      <div className="border-b border-gray-100 px-5 pt-4"><nav className="flex gap-1">{[
        {key:'today',label:`Dia — ${fmtDate(selDate)}`},
        {key:'month',label:`Mês — ${monthLabel}`},
        {key:'pay',  label:'Por Pagamento'},
      ].map(t=><button key={t.key} onClick={()=>setTab(t.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab===t.key?'border-emerald-600 text-emerald-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label}</button>)}</nav></div>
      <div className="p-5">
        {tab==='today'&&<DashTable rows={data?.today} cols={pointCols} emptyMsg="Nenhuma reserva confirmada hoje"/>}
        {tab==='month'&&<DashTable rows={data?.monthByPoint} cols={pointCols} emptyMsg="Nenhuma reserva no mês"/>}
        {tab==='pay'&&<DashTable rows={data?.monthByPay} cols={payCols} emptyMsg="Nenhuma reserva no mês"/>}
      </div>
    </div>

    {/* Resumo por Aluno/Cliente */}
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h2 className="font-bold text-gray-800 mb-4">🔍 Resumo por Aluno / Cliente</h2>
      <div className="flex gap-2 mb-5">
        <input value={clienteSearch} onChange={e=>setClienteSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&buscarCliente()} placeholder="Buscar por nome do cliente ou aluno..." className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
        <Btn onClick={buscarCliente} disabled={clienteLoading}>{clienteLoading?'Buscando...':'Buscar'}</Btn>
        {clienteData&&<Btn variant="secondary" onClick={exportPDF}>📄 Exportar PDF</Btn>}
      </div>

      {clienteLoading&&<Spinner text="Buscando dados do cliente..."/>}

      {clienteData&&!clienteLoading&&<div id="cliente-pdf-area">
        <h1 style={{color:'#059669',marginBottom:'4px'}}>Resumo — {clienteData.cliente}</h1>

        {/* Totais resumo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            {label:'Aulas',value:clienteData.totais.aulas,icon:'🎓',color:'bg-blue-50'},
            {label:'Reservas',value:clienteData.totais.reservas,icon:'📅',color:'bg-emerald-50'},
            {label:'Bar',value:clienteData.totais.bar,icon:'🍺',color:'bg-amber-50'},
            {label:'Loja & Equipamentos',value:clienteData.totais.manutencao,icon:'🛒',color:'bg-purple-50'},
          ].map(c=><div key={c.label} className={`${c.color} rounded-xl p-3 text-center`}>
            <p className="text-xl">{c.icon}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className="font-black text-gray-800 text-sm">{fmt$(c.value)}</p>
          </div>)}
        </div>
        <div className="bg-emerald-50 rounded-xl p-3 flex justify-between items-center mb-5">
          <span className="font-bold text-emerald-800">Total Geral</span>
          <span className="font-black text-emerald-700 text-xl">{fmt$(clienteData.totais.geral)}</span>
        </div>

        {/* Planos de Aula */}
        {clienteData.planos.length>0&&<><h2 className="font-bold text-gray-700 mb-2">🎓 Planos de Aula ({clienteData.planos.length})</h2>
        <div className="overflow-x-auto mb-5"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Plano','Professor','Horário','Recorrência','Início','Valor','Status'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{clienteData.planos.map(p=><tr key={p.id}>
          <td className="px-3 py-2 font-medium">{TIPO_PLANO_LABEL[p.tipo_plano]||p.tipo_plano}</td>
          <td className="px-3 py-2">{p.professor_nome||'—'}</td>
          <td className="px-3 py-2">{p.horario_inicio&&p.horario_fim?`${p.horario_inicio}–${p.horario_fim}`:'—'}</td>
          <td className="px-3 py-2">{RECORRENCIA_LABEL[p.recorrencia]||p.recorrencia}</td>
          <td className="px-3 py-2">{fmtDate(p.data_inicio)}</td>
          <td className="px-3 py-2 font-semibold text-emerald-700">{fmt$(p.valor)}</td>
          <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.status==='ativo'?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-500'}`}>{p.status}</span></td>
        </tr>)}</tbody></table></div></>}

        {/* Reservas */}
        {clienteData.reservas.length>0&&<><h2 className="font-bold text-gray-700 mb-2">📅 Reservas de Espaço ({clienteData.reservas.length})</h2>
        <div className="overflow-x-auto mb-5"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Data','Local','Espaço','Horário','Valor','Status'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{clienteData.reservas.map(r=><tr key={r.id}>
          <td className="px-3 py-2">{fmtDate(typeof r.date==='string'?r.date:r.date.split('T')[0])}</td>
          <td className="px-3 py-2">{r.est_name}</td>
          <td className="px-3 py-2">{r.point_name}</td>
          <td className="px-3 py-2">{r.start_time}–{r.end_time}</td>
          <td className="px-3 py-2 font-semibold text-emerald-700">{fmt$(r.total)}</td>
          <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{statusLabel(r.status)}</span></td>
        </tr>)}</tbody></table></div></>}

        {/* Bar */}
        {clienteData.bar.length>0&&<><h2 className="font-bold text-gray-700 mb-2">🍺 Consumo de Bar ({clienteData.bar.length})</h2>
        <div className="overflow-x-auto mb-5"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Data','Local','Itens','Total'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{clienteData.bar.map(b=><tr key={b.id}>
          <td className="px-3 py-2">{new Date(b.created_at).toLocaleDateString('pt-BR')}</td>
          <td className="px-3 py-2">{b.est_name||'—'}</td>
          <td className="px-3 py-2 text-xs">{(b.itens||[]).map(i=>`${i.nome} ×${i.quantidade}`).join(', ')}</td>
          <td className="px-3 py-2 font-semibold text-emerald-700">{fmt$(b.total)}</td>
        </tr>)}</tbody></table></div></>}

        {/* Manutenção */}
        {clienteData.manutencao.length>0&&<><h2 className="font-bold text-gray-700 mb-2">🛒 Loja & Equipamentos ({clienteData.manutencao.length})</h2>
        <div className="overflow-x-auto mb-5"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Data','Local','Itens','Total'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">{clienteData.manutencao.map(m=><tr key={m.id}>
          <td className="px-3 py-2">{new Date(m.created_at).toLocaleDateString('pt-BR')}</td>
          <td className="px-3 py-2">{m.est_name||'—'}</td>
          <td className="px-3 py-2 text-xs">{(m.itens||[]).map(i=>`${i.nome} ×${i.quantidade}`).join(', ')}</td>
          <td className="px-3 py-2 font-semibold text-emerald-700">{fmt$(m.total)}</td>
        </tr>)}</tbody></table></div></>}

        {clienteData.planos.length===0&&clienteData.reservas.length===0&&clienteData.bar.length===0&&clienteData.manutencao.length===0&&
          <div className="text-center py-8 text-gray-400"><p className="text-3xl mb-2">🔍</p><p>Nenhum registro encontrado para "<strong>{clienteData.cliente}</strong>"</p></div>}
      </div>}
    </div>
  </div>;
}

// CRM ESTABLISHMENT
// ================================================================
function CRMEstablishment({showToast}){
  const BLANK={name:'',responsible:'',cpf_cnpj:'',phone:'',email:'',site:'',unimidia:'nao',aulas:false,street:'',number:'',complement:'',cep:'',city:'',state:'',photos:[],main_photo:'',operating_hours:{...DEFAULT_HOURS}};
  const [tab,setTab]=useState('consulta');
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState(BLANK);
  const [cepLoading,setCepLoading]=useState(false);
  const [uploading,setUploading]=useState(false);

  const loadList=()=>{setLoading(true);estApi.list().then(setEsts).catch(()=>{}).finally(()=>setLoading(false));};
  useEffect(()=>{loadList();},[]);

  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));

  const openNew=()=>{setEditId(null);setForm(BLANK);setTab('cadastro');};
  const openEdit=async(e)=>{
    setEditId(e.id);
    setForm({...BLANK,name:e.name||'',phone:e.phone||'',street:e.street||'',number:e.number||'',complement:e.complement||'',cep:e.cep||'',city:e.city||'',state:e.state||'',photos:e.photos||[],main_photo:e.main_photo||'',operating_hours:e.operating_hours||{...DEFAULT_HOURS},aulas:!!e.aulas});
    try{const full=await estApi.getFull(e.id);setForm(f=>({...f,responsible:full.responsible||'',cpf_cnpj:full.cpf_cnpj||'',email:full.email||'',site:full.site||'',unimidia:full.unimidia_divulgacao?'sim':'nao',aulas:!!full.aulas}));}catch{}
    setTab('cadastro');
  };

  const handleCEP=async(v)=>{upd('cep',v);if(v.replace(/\D/g,'').length===8){setCepLoading(true);const d=await viaCEP(v);setCepLoading(false);if(d){upd('street',d.logradouro);upd('city',d.localidade);upd('state',d.uf);showToast('Endereço preenchido!','success');}}};
  const addPhotosFromFiles=async(e)=>{
    const files=Array.from(e.target.files);
    if(!files.length)return;
    setUploading(true);
    for(const file of files){
      if(!file.type.startsWith('image/')){showToast(`${file.name}: somente imagens`,'error');continue;}
      if(file.size>20*1024*1024){showToast(`${file.name}: máx. 20MB`,'error');continue;}
      const dataUrl=await compressImage(file);
      if(dataUrl)setForm(f=>({...f,photos:[...f.photos,dataUrl],main_photo:f.main_photo||dataUrl}));
    }
    setUploading(false);
    e.target.value='';
  };
  const rmPhoto=(u)=>setForm(f=>({...f,photos:f.photos.filter(p=>p!==u),main_photo:f.main_photo===u?(f.photos.find(p=>p!==u)||''):f.main_photo}));

  const save=async()=>{
    if(!form.name||!form.responsible||!form.phone){showToast('Preencha os campos obrigatórios','error');return;}
    setSaving(true);
    try{
      const payload={...form,unimidia_divulgacao:form.unimidia==='sim',aulas:!!form.aulas};
      if(editId){await estApi.update(editId,payload);}else{await estApi.create(payload);}
      showToast('Estabelecimento salvo!','success');
      loadList();
      setTab('consulta');
    }catch(e){showToast(e.message,'error');}finally{setSaving(false);}
  };

  const TabBtn=({id,label})=><button onClick={()=>setTab(id)} className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${tab===id?'bg-emerald-600 text-white shadow-sm':'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>{label}</button>;

  if(loading)return<Spinner/>;

  return<div className="p-6 max-w-5xl">
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-black text-gray-900">Estabelecimentos</h1>
      <div className="flex items-center gap-3">
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1"><TabBtn id="consulta" label="📋 Consulta"/><TabBtn id="cadastro" label="➕ Cadastro"/></div>
        {tab==='consulta'&&<Btn onClick={openNew}>+ Novo</Btn>}
        {tab==='cadastro'&&<Btn onClick={save} disabled={saving}>{saving?'Salvando...':'💾 Salvar'}</Btn>}
      </div>
    </div>

    {tab==='consulta'&&<div>
      {ests.length===0
        ?<div className="text-center py-20 text-gray-400"><p className="text-5xl mb-3">🏢</p><p className="text-lg">Nenhum estabelecimento cadastrado</p><Btn className="mt-5" onClick={openNew}>+ Cadastrar primeiro estabelecimento</Btn></div>
        :<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>{['Nome','Cidade / UF','Telefone','Ações'].map(h=><th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h==='Ações'?'text-right':''}`}>{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ests.map(e=><tr key={e.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-semibold text-gray-800">{e.name}</td>
                <td className="px-4 py-3 text-gray-500">{e.city&&e.state?`${e.city} / ${e.state}`:e.city||e.state||'—'}</td>
                <td className="px-4 py-3 text-gray-500">{e.phone||'—'}</td>
                <td className="px-4 py-3 text-right"><Btn variant="secondary" size="sm" onClick={()=>openEdit(e)}>Editar</Btn></td>
              </tr>)}
            </tbody>
          </table>
          </div>
        </div>
      }
    </div>}

    {tab==='cadastro'&&<div>
      {editId&&<p className="text-xs text-emerald-600 font-medium mb-4">✏️ Editando estabelecimento existente — <button className="underline" onClick={openNew}>ou criar novo</button></p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="space-y-5"><div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4"><h2 className="font-bold text-gray-700">Dados Gerais</h2><Field label="Nome do Local" badge="pub" required><Inp value={form.name} onChange={e=>upd('name',e.target.value)}/></Field><Field label="Responsável" badge="int" required><Inp value={form.responsible} onChange={e=>upd('responsible',e.target.value)}/></Field><Field label="CPF / CNPJ" badge="int"><Inp value={form.cpf_cnpj} onChange={e=>upd('cpf_cnpj',e.target.value)}/></Field><Field label="Telefone" badge="pub" required><Inp value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="(00) 00000-0000"/></Field><Field label="Email" badge="int"><Inp type="email" value={form.email} onChange={e=>upd('email',e.target.value)}/></Field><Field label="Site" badge="pub"><Inp type="url" value={form.site} onChange={e=>upd('site',e.target.value)} placeholder="https://www.exemplo.com.br"/></Field><Field label="Divulgação via Unimídia"><Sel value={form.unimidia} onChange={e=>upd('unimidia',e.target.value)} options={[{value:'nao',label:'Não'},{value:'sim',label:'Sim — quero divulgar via Unimídia'}]}/></Field>
<Field label="Aulas" help="Habilita cadastro de professores e planos de aula para este estabelecimento"><label className="flex items-center gap-3 cursor-pointer mt-1"><input type="checkbox" checked={!!form.aulas} onChange={e=>upd('aulas',e.target.checked)} className="w-5 h-5 accent-emerald-600 rounded"/><span className="text-sm text-gray-700">{form.aulas?'Sim — este estabelecimento oferece aulas':'Não'}</span></label></Field>
</div><div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3"><h2 className="font-bold text-gray-700">Endereço <span className="text-xs font-normal text-blue-500 ml-1">🌐 Público</span></h2><Field label="CEP" help={cepLoading?'Buscando endereço...':''}><Inp value={form.cep} onChange={e=>handleCEP(e.target.value)} placeholder="00000-000"/></Field><Field label="Rua"><Inp value={form.street} onChange={e=>upd('street',e.target.value)}/></Field><div className="grid grid-cols-2 gap-3"><Field label="Número"><Inp value={form.number} onChange={e=>upd('number',e.target.value)}/></Field><Field label="Complemento"><Inp value={form.complement} onChange={e=>upd('complement',e.target.value)}/></Field></div><div className="grid grid-cols-3 gap-3"><div className="col-span-2"><Field label="Cidade"><Inp value={form.city} onChange={e=>upd('city',e.target.value)}/></Field></div><Field label="UF"><Inp value={form.state} onChange={e=>upd('state',e.target.value.toUpperCase().slice(0,2))} placeholder="SP"/></Field></div></div></div><div className="space-y-5"><div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3"><h2 className="font-bold text-gray-700">Fotos <span className="text-xs font-normal text-blue-500 ml-1">🌐 Público</span></h2><label className={`flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors ${uploading?'border-emerald-300 bg-emerald-50':'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50'}`}><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={addPhotosFromFiles} disabled={uploading}/><span className="text-3xl">{uploading?'⏳':'📷'}</span><div className="text-center"><p className="text-sm font-medium text-gray-700">{uploading?'Processando...':'Clique para adicionar fotos'}</p><p className="text-xs text-gray-400">JPEG · PNG · WebP · máx. 20MB por foto · otimizadas automaticamente</p></div></label>{form.photos.length===0&&<p className="text-xs text-gray-400 text-center py-1">Nenhuma foto adicionada</p>}<div className="grid grid-cols-2 gap-2">{form.photos.map((ph,i)=><div key={i} className={`relative rounded-xl overflow-hidden border-2 ${form.main_photo===ph?'border-emerald-500':'border-transparent'}`}><img src={ph} alt="" className="w-full h-28 object-cover" onError={e=>e.target.style.display='none'}/><div className="absolute bottom-0 left-0 right-0 flex gap-1 p-1.5"><button onClick={()=>upd('main_photo',ph)} className="flex-1 text-xs text-white bg-emerald-600/90 rounded-lg py-1">{form.main_photo===ph?'★ Principal':'★'}</button><button onClick={()=>rmPhoto(ph)} className="text-xs text-white bg-red-600/90 rounded-lg px-2 py-1">✕</button></div></div>)}</div></div><div className="bg-white rounded-2xl border border-gray-100 p-5"><h2 className="font-bold text-gray-700 mb-1">Horário de Funcionamento <span className="text-xs font-normal text-blue-500 ml-1">🌐 Público</span></h2><p className="text-xs text-gray-400 mb-3">Padrão herdado por todos os pontos</p><HoursEditor value={form.operating_hours} onChange={v=>upd('operating_hours',v)}/></div></div></div>
    </div>}
  </div>;
}
// ================================================================
function CRMPoints({crmUser,showToast}){
  const [points,setPoints]=useState([]);
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [selEst,setSelEst]=useState('');
  const [showForm,setShowForm]=useState(false);
  const [editPt,setEditPt]=useState(null);
  const [f,setF]=useState({est_id:'',type:'',name:'',price_per_hour:'',custom_hours:null});
  const [customH,setCustomH]=useState(false);
  const [temPrecoAluno,setTemPrecoAluno]=useState(false);
  const [delPt,setDelPt]=useState(null);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const isAdmin=crmUser?.role==='admin';
  const isManager=crmUser?.role==='manager';
  const canEdit=isAdmin||isManager;

  const load=()=>{
    Promise.all([pointApi.list(),estApi.list()]).then(([p,e])=>{setPoints(p);setEsts(e);}).catch(()=>{}).finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);

  const openNew=()=>{setF({est_id:ests[0]?.id||'',type:'',name:'',price_per_hour:'',price_per_hour_aluno:'',custom_hours:null});setCustomH(false);setTemPrecoAluno(false);setEditPt(null);setShowForm(true);};
  const openEdit=(p)=>{setF({est_id:p.est_id||ests[0]?.id||'',type:p.type,name:p.name,price_per_hour:p.price_per_hour,price_per_hour_aluno:p.price_per_hour_aluno||'',custom_hours:p.custom_hours});setCustomH(!!p.custom_hours);setTemPrecoAluno(!!p.price_per_hour_aluno);setEditPt(p);setShowForm(true);};

  const save=async()=>{
    if(!f.est_id||!f.type||!f.name||!f.price_per_hour){showToast('Preencha todos os campos obrigatórios','error');return;}
    const payload={...f,price_per_hour_aluno:temPrecoAluno&&f.price_per_hour_aluno?Number(f.price_per_hour_aluno):null,custom_hours:customH?(f.custom_hours||{...DEFAULT_HOURS}):null};
    try{
      if(editPt){await pointApi.update(editPt.id,payload);}
      else{await pointApi.create(payload);}
      showToast('Ponto salvo!','success');setShowForm(false);load();
    }catch(e){showToast(e.message,'error');}
  };

  const del=async(id)=>{
    try{await pointApi.remove(id);showToast('Ponto excluído','info');setDelPt(null);load();}
    catch(e){showToast(e.message,'error');}
  };

  if(loading)return<Spinner/>;

  const filteredPts=selEst?points.filter(pt=>String(pt.est_id)===String(selEst)):[];
  return<div className="p-6"><div className="flex items-center justify-between mb-6"><h1 className="text-2xl font-black text-gray-900">Pontos / Espaços</h1>{canEdit&&<Btn onClick={openNew}>+ Novo Ponto</Btn>}</div><div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 flex items-center gap-3"><div className="flex-1"><Sel value={selEst} onChange={e=>setSelEst(e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione um estabelecimento..."/></div>{selEst&&<button onClick={()=>setSelEst('')} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap">✕ Limpar</button>}</div>{!selEst?<div className="text-center py-20 text-gray-400"><p className="text-5xl mb-3">🏢</p><p className="text-lg">Selecione um estabelecimento para ver os pontos</p></div>:<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{filteredPts.length===0?<div className="col-span-3 text-center py-16 text-gray-400"><p className="text-4xl mb-2">📍</p><p>Nenhum ponto neste estabelecimento</p></div>:filteredPts.map(pt=><div key={pt.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"><div className="flex items-start justify-between mb-2"><div className="min-w-0"><h3 className="font-bold text-gray-800 truncate">{pt.name}</h3><p className="text-xs text-gray-500 mt-0.5">{pt.type}</p></div><div className="text-right shrink-0 ml-2"><p className="text-emerald-600 font-black text-lg">{fmt$(pt.price_per_hour)}</p><p className="text-xs text-gray-400">/hora</p>{pt.price_per_hour_aluno&&<p className="text-xs text-blue-600 font-semibold mt-0.5">Aluno: {fmt$(pt.price_per_hour_aluno)}/h</p>}</div></div><p className="text-xs text-gray-400 mb-3">{pt.custom_hours?'⏰ Horário próprio':'📋 Herda do estabelecimento'}</p>{canEdit&&<div className="flex gap-2"><Btn variant="secondary" size="sm" onClick={()=>openEdit(pt)}>Editar</Btn>{canEdit&&<Btn variant="danger" size="sm" onClick={()=>setDelPt(pt)}>Excluir</Btn>}</div>}</div>)}</div>}<Modal open={showForm} onClose={()=>setShowForm(false)} title={editPt?'Editar Ponto':'Novo Ponto'} maxW="max-w-xl"><div className="space-y-4"><Field label="Estabelecimento" required><Sel value={f.est_id} onChange={e=>upd('est_id',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/></Field><Field label="Tipo de Espaço" required><Sel value={f.type} onChange={e=>upd('type',e.target.value)} options={ESTABLISHMENT_TYPES} placeholder="Selecione..."/></Field><Field label="Nome do Ponto" required><Inp value={f.name} onChange={e=>upd('name',e.target.value)}/></Field><Field label="Valor por hora (R$)" required><Inp type="number" value={f.price_per_hour} onChange={e=>upd('price_per_hour',Number(e.target.value))}/></Field>
        <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
          <input type="checkbox" checked={temPrecoAluno} onChange={e=>{setTemPrecoAluno(e.target.checked);if(!e.target.checked)upd('price_per_hour_aluno','');}} className="w-4 h-4 accent-emerald-600"/>
          <span className="text-sm font-medium text-gray-700">Preço especial para aluno</span>
        </label>
        {temPrecoAluno&&<Field label="Valor por hora — Aluno (R$)" required><Inp type="number" value={f.price_per_hour_aluno} onChange={e=>upd('price_per_hour_aluno',e.target.value)} placeholder="Ex: 70,00"/></Field>}<div className="bg-amber-50 border border-amber-100 rounded-xl p-3"><label className="flex items-start gap-2.5 cursor-pointer"><input type="checkbox" checked={customH} onChange={e=>setCustomH(e.target.checked)} className="w-4 h-4 accent-emerald-600 mt-0.5"/><div><p className="text-sm font-medium text-gray-700">Horário próprio para este ponto</p><p className="text-xs text-gray-400">Por padrão herda do estabelecimento</p></div></label></div>{customH&&<HoursEditor value={f.custom_hours||{...DEFAULT_HOURS}} onChange={v=>upd('custom_hours',v)}/>}<div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setShowForm(false)}>Cancelar</Btn><Btn className="flex-1" onClick={save}>Salvar</Btn></div></div></Modal><Modal open={!!delPt} onClose={()=>setDelPt(null)} title="Confirmar Exclusão"><p className="text-sm text-gray-600 mb-5">Excluir <strong>"{delPt?.name}"</strong>?</p><div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setDelPt(null)}>Cancelar</Btn><Btn variant="danger" className="flex-1" onClick={()=>del(delPt.id)}>Excluir</Btn></div></Modal></div>;
}

// ================================================================
// CRM USERS
// ================================================================
const ROLE_OPTS=[{value:'admin',label:'Administrador — acesso total'},{value:'manager',label:'Gerente — dashboard + reservas do est.'},{value:'simples',label:'Usuário Simples — somente reservas'}];
const ROLE_BADGE={admin:'blue',manager:'green',simples:'gray',professor:'emerald',recepcao:'yellow',profissional:'purple'};
const ROLE_NAME={admin:'Administrador',manager:'Gerente',simples:'Simples',professor:'Professor',recepcao:'Recepção',profissional:'Prof. EF'};

function CRMUsers({crmUser,showToast}){
  const [users,setUsers]=useState([]);
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [estSearch,setEstSearch]=useState('');
  const [showForm,setShowForm]=useState(false);
  const [editU,setEditU]=useState(null);
  const [f,setF]=useState({name:'',email:'',password:'',pw2:'',role:'manager',est_id:'',est_ids:[]});
  const [err,setErr]=useState({});
  const [delU,setDelU]=useState(null);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const isAdmin=crmUser?.role==='admin';
  const ROLE_OPTS=isAdmin
    ?[{value:'admin',label:'Administrador — acesso total'},{value:'manager',label:'Gerente — vários estabelecimentos'},{value:'simples',label:'Usuário Simples — somente reservas'},{value:'professor',label:'Professor — alunos + planos + reservas'},{value:'recepcao',label:'Recepção — somente reservas'},{value:'profissional',label:'Profissional EF — personal trainer'}]
    :[{value:'professor',label:'Professor — alunos + planos + reservas'},{value:'recepcao',label:'Recepção — somente reservas'},{value:'simples',label:'Usuário Simples — somente reservas'}];
  const needsEstMulti=f.role==='manager';
  const needsEstSingle=['simples','professor','recepcao'].includes(f.role);

  const load=()=>{
    Promise.all([userApi.list(),estApi.list()]).then(([u,e])=>{setUsers(u);setEsts(e);}).catch(()=>{}).finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);

  const openNew=()=>{setF({name:'',email:'',password:'',pw2:'',role:isAdmin?'manager':'professor',est_id:isAdmin?'':ests[0]?.id||'',est_ids:[],professor_id:''});setEditU(null);setErr({});setShowForm(true);};
  const openEdit=(u)=>{setF({name:u.name,email:u.email,password:'',pw2:'',role:u.role,est_id:u.est_id||'',est_ids:(u.est_ids||[]).map(Number),professor_id:u.professor_id||''});setEditU(u);setErr({});setShowForm(true);};

  const validate=()=>{
    const e={};
    if(!f.name)e.name='Obrigatório';
    if(!f.email)e.email='Obrigatório';
    if(!editU&&!f.password)e.password='Obrigatório';
    if(f.password&&f.password.length<6)e.password='Mínimo 6 caracteres';
    if(f.password&&f.password!==f.pw2)e.pw2='Senhas não coincidem';
    if(needsEstSingle&&!f.est_id)e.est_id='Selecione um estabelecimento';
    setErr(e);return!Object.keys(e).length;
  };

  const save=async()=>{
    if(!validate())return;
    try{
      const payload={name:f.name,email:f.email,role:f.role,est_id:needsEstSingle?f.est_id:null,est_ids:needsEstMulti?f.est_ids:[],professor_id:f.role==='professor'?(f.professor_id||null):null,...(f.password?{password:f.password}:{})};
      if(editU){await userApi.update(editU.id,payload);}else{await userApi.create({...payload,password:f.password});}
      showToast('Usuário salvo!','success');setShowForm(false);load();
    }catch(e){showToast(e.message,'error');}
  };

  const del=async(id)=>{
    try{await userApi.remove(id);showToast('Usuário excluído','info');setDelU(null);load();}
    catch(e){showToast(e.message,'error');}
  };

  const toggleSuspend=async(u)=>{
    try{
      await userApi.suspend(u.id);
      showToast(u.ativo?'Usuário suspenso':'Usuário reativado','info');
      load();
    }catch(e){showToast(e.message,'error');}
  };

  if(loading)return<Spinner/>;

  return<div className="p-6"><div className="flex items-center justify-between mb-6"><h1 className="text-2xl font-black text-gray-900">Usuários do Sistema</h1><Btn onClick={openNew}>+ Novo Usuário</Btn></div>
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
    <div className="overflow-x-auto">
    <table className="w-full text-sm"><thead className="bg-gray-50 border-b border-gray-100"><tr>{['Nome','Email','Perfil','Estabelecimento(s)','Ações'].map(h=><th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h==='Ações'?'text-right':''}`}>{h}</th>)}</tr></thead>
    <tbody className="divide-y divide-gray-50">{users.map(u=><tr key={u.id} className={`hover:bg-gray-50 ${!u.ativo?'opacity-50':''}`}>
      <td className="px-4 py-3 font-semibold text-gray-800"><span>{u.name}</span>{!u.ativo&&<span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-normal">Suspenso</span>}</td>
      <td className="px-4 py-3 text-gray-500">{u.email}</td>
      <td className="px-4 py-3"><Badge color={ROLE_BADGE[u.role]||'gray'}>{ROLE_NAME[u.role]||u.role}</Badge></td>
      <td className="px-4 py-3 text-gray-500 text-xs">{u.role==='manager'?(u.est_ids&&u.est_ids.length>0?ests.filter(e=>u.est_ids.map(Number).includes(Number(e.id))).map(e=>e.name).join(', '):<span className="italic text-gray-300">—</span>):(u.est_name||<span className="italic text-gray-300">—</span>)}</td>
      <td className="px-4 py-3"><div className="flex gap-2 justify-end">{isAdmin&&<><Btn variant="secondary" size="sm" onClick={()=>openEdit(u)}>Editar</Btn><Btn variant={u.ativo?'warning':'success'} size="sm" onClick={()=>toggleSuspend(u)}>{u.ativo?'Suspender':'Reativar'}</Btn><Btn variant="danger" size="sm" onClick={()=>setDelU(u)}>Excluir</Btn></>}</div></td>
    </tr>)}</tbody></table>
    </div>
    {users.length===0&&<div className="text-center py-12 text-gray-400">Nenhum usuário</div>}
  </div>
  <Modal open={showForm} onClose={()=>setShowForm(false)} title={editU?'Editar Usuário':'Novo Usuário'}><div className="space-y-3">
    <Field label="Nome" required><Inp value={f.name} onChange={e=>upd('name',e.target.value)}/>{err.name&&<p className="text-xs text-red-500">{err.name}</p>}</Field>
    <Field label="Email" required><Inp type="email" value={f.email} onChange={e=>upd('email',e.target.value)}/>{err.email&&<p className="text-xs text-red-500">{err.email}</p>}</Field>
    <Field label="Perfil"><Sel value={f.role} onChange={e=>{const r=e.target.value;setF(p=>({...p,role:r,est_id:['simples','professor','recepcao'].includes(r)?p.est_id:'',est_ids:r==='manager'?p.est_ids:[],professor_id:''}));}} options={ROLE_OPTS}/></Field>
    {needsEstMulti&&<Field label="Estabelecimentos (opcional)"><div className="border border-gray-200 rounded-xl p-3 space-y-2 max-h-48 overflow-y-auto">{ests.length===0?<p className="text-sm text-gray-400 italic">Nenhum estabelecimento ainda — o gerente pode criar o próprio após o login e será vinculado automaticamente.</p>:ests.map(est=><label key={est.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded p-1"><input type="checkbox" checked={f.est_ids.map(Number).includes(Number(est.id))} onChange={ev=>{const id=Number(est.id);upd('est_ids',ev.target.checked?[...f.est_ids,id]:f.est_ids.filter(x=>Number(x)!==id));}} className="w-4 h-4 accent-emerald-600"/><span className="text-sm text-gray-700">{est.name}</span></label>)}</div><p className="text-xs text-gray-400 mt-1">Ao criar um estabelecimento, o gerente é vinculado automaticamente.</p></Field>}
    {needsEstSingle&&<Field label="Estabelecimento" required><Sel value={f.est_id} onChange={e=>upd('est_id',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/>{err.est_id&&<p className="text-xs text-red-500">{err.est_id}</p>}</Field>}
    <Field label={editU?'Nova senha (vazio = manter)':'Senha'} required={!editU}><Inp type="password" value={f.password} onChange={e=>upd('password',e.target.value)}/>{err.password&&<p className="text-xs text-red-500">{err.password}</p>}</Field>
    {f.password&&<Field label="Confirmar senha" required><Inp type="password" value={f.pw2} onChange={e=>upd('pw2',e.target.value)}/>{err.pw2&&<p className="text-xs text-red-500">{err.pw2}</p>}</Field>}
    <div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setShowForm(false)}>Cancelar</Btn><Btn className="flex-1" onClick={save}>Salvar</Btn></div>
  </div></Modal>
  <Modal open={!!delU} onClose={()=>setDelU(null)} title="Excluir Usuário"><p className="text-sm text-gray-600 mb-5">Excluir <strong>{delU?.name}</strong>?</p><div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setDelU(null)}>Cancelar</Btn><Btn variant="danger" className="flex-1" onClick={()=>del(delU.id)}>Excluir</Btn></div></Modal>
  </div>;
}

// ================================================================
// CRM RECORRENTES (aba dentro de Reservas)
// ================================================================
const DOW_LABELS=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DOW_OPTIONS=[{value:1,label:'Segunda-feira'},{value:2,label:'Terça-feira'},{value:3,label:'Quarta-feira'},{value:4,label:'Quinta-feira'},{value:5,label:'Sexta-feira'},{value:6,label:'Sábado'},{value:0,label:'Domingo'}];
const MONTH_NAMES=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function CRMRecorrentes({showToast,crmUser}){
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [ests,setEsts]=useState([]);
  const [alunos,setAlunos]=useState([]);

  // Modal nova recorrência
  const RNEW={estId:'',pointId:'',dayOfWeek:'',startTime:'',endTime:'',hours:1,clientName:'',clientPhone:'',clientEmail:'',participantes:[],pm:'dinheiro',startDate:TODAY,obs:'',alunoDoProf:false,professorId:''};
  const [showNew,setShowNew]=useState(false);
  const [rn,setRn]=useState(RNEW);
  const [rnPoints,setRnPoints]=useState([]);
  const [rnSlots,setRnSlots]=useState([]);
  const [rnProfessores,setRnProfessores]=useState([]);
  const [saving,setSaving]=useState(false);
  // autocomplete de cliente
  const [rnNameInput,setRnNameInput]=useState('');
  const [rnShowSugg,setRnShowSugg]=useState(false);
  const rnSugg=alunos.filter(a=>rnNameInput.length>0&&a.nome.toLowerCase().includes(rnNameInput.toLowerCase())).slice(0,8);
  const selRnAluno=(a)=>{setRn(r=>({...r,clientName:a.nome,clientPhone:a.telefone||'',clientEmail:a.email||''}));setRnNameInput(a.nome);setRnShowSugg(false);};
  const updRn=(k,v)=>setRn(r=>({...r,[k]:v}));
  const resetNew=()=>{setShowNew(false);setRn(RNEW);setRnNameInput('');setRnPoints([]);setRnSlots([]);};

  // Modal fatura
  const [invoiceTarget,setInvoiceTarget]=useState(null); // item recorrente
  const [invoiceYear,setInvoiceYear]=useState(new Date().getFullYear());
  const [invoiceMonth,setInvoiceMonth]=useState(new Date().getMonth()+1);
  const [invoiceData,setInvoiceData]=useState(null);
  const [invoiceLoading,setInvoiceLoading]=useState(false);

  const load=useCallback(()=>{
    setLoading(true);
    recurringApi.list().then(setItems).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{
    if(!showNew)return;
    estApi.list().then(ests=>{
      setEsts(ests);
      if(!rn.estId){
        const userEstId=crmUser?.est_id||(crmUser?.est_ids&&crmUser.est_ids[0]);
        if(userEstId)updRn('estId',String(userEstId));
      }
    }).catch(()=>{});
    alunoApi.list().then(setAlunos).catch(()=>{});
  },[showNew]);
  useEffect(()=>{
    if(!rn.estId){setRnPoints([]);setRnProfessores([]);updRn('pointId','');return;}
    pointApi.list(rn.estId).then(setRnPoints).catch(()=>{});
    professorApi.list(rn.estId).then(setRnProfessores).catch(()=>{});
    updRn('pointId','');
  },[rn.estId]);
  // Gerar slots de horário baseado no ponto
  useEffect(()=>{
    if(!rn.pointId)return;
    // Pega slots de uma data qualquer (não importa qual, só pra listar horários disponíveis)
    const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    const ds=tomorrow.toISOString().split('T')[0];
    pointApi.slots(rn.pointId,ds).then(s=>setRnSlots(s.map(x=>x.time))).catch(()=>setRnSlots([]));
  },[rn.pointId]);

  const saveNew=async()=>{
    if(!rn.estId||!rn.pointId||rn.dayOfWeek===''||!rn.startTime||!rn.endTime||!rn.clientName||!rn.clientPhone){
      showToast('Preencha: estabelecimento, ponto, dia da semana, horário, nome e telefone','error');return;
    }
    setSaving(true);
    try{
      await recurringApi.create({
        est_id:Number(rn.estId),point_id:Number(rn.pointId),
        day_of_week:Number(rn.dayOfWeek),
        start_time:rn.startTime,end_time:rn.endTime,hours:Number(rn.hours)||1,
        client_name:rn.clientName,client_phone:rn.clientPhone,client_email:rn.clientEmail||undefined,
        participantes:rn.participantes.filter(p=>p.nome),
        payment_method:rn.pm,start_date:rn.startDate||undefined,observacoes:rn.obs||undefined,
        professor_id:rn.alunoDoProf&&rn.professorId?Number(rn.professorId):undefined,
      });
      showToast('Recorrência criada!','success');resetNew();load();
    }catch(e){showToast(e.message,'error');}finally{setSaving(false);}
  };

  const toggleActive=async(item)=>{
    try{
      await recurringApi.update(item.id,{ativo:!item.ativo});
      showToast(item.ativo?'Recorrência pausada':'Recorrência ativada','success');load();
    }catch(e){showToast(e.message,'error');}
  };

  const removeItem=async(item)=>{
    if(!window.confirm(`Excluir recorrência de ${item.client_name}?`))return;
    try{await recurringApi.remove(item.id);showToast('Removida','success');load();}
    catch(e){showToast(e.message,'error');}
  };

  const openInvoice=(item)=>{
    setInvoiceTarget(item);
    setInvoiceData(null);
    const now=new Date();
    setInvoiceYear(now.getFullYear());
    setInvoiceMonth(now.getMonth()+1);
  };

  const generateInvoice=async()=>{
    if(!invoiceTarget)return;
    setInvoiceLoading(true);
    try{
      const data=await recurringApi.generate(invoiceTarget.id,invoiceYear,invoiceMonth);
      setInvoiceData(data);
    }catch(e){showToast(e.message,'error');}finally{setInvoiceLoading(false);}
  };

  const printInvoice=()=>{
    if(!invoiceData)return;
    const d=invoiceData;
    const PAY_LABEL_MAP={pix:'Pix',credito:'Crédito',debito:'Débito',dinheiro:'Dinheiro'};
    const fmtCur=v=>`R$ ${Number(v).toFixed(2).replace('.',',')}`;
    const fmtDate=ds=>{const[y,m,day]=ds.split('-');return`${day}/${m}/${y}`;};
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Fatura ${MONTH_NAMES[d.month-1]}/${d.year} — ${d.recurring.client_name}</title>
<style>
  body{font-family:sans-serif;padding:32px;color:#111;max-width:700px;margin:0 auto;}
  h1{font-size:22px;margin-bottom:4px;}
  .sub{color:#666;font-size:14px;margin-bottom:24px;}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  th,td{border:1px solid #ddd;padding:8px 10px;font-size:13px;}
  th{background:#f5f5f5;font-weight:600;}
  .total-row td{font-weight:700;background:#f0fdf4;}
  .section{margin-bottom:24px;}
  .label{font-size:12px;color:#666;margin-bottom:2px;}
  .value{font-size:15px;font-weight:600;}
  @media print{button{display:none;}}
</style></head><body>
<h1>Fatura de Reserva Recorrente</h1>
<p class="sub">${MONTH_NAMES[d.month-1]} ${d.year}</p>
<div class="section" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
  <div><p class="label">Cliente</p><p class="value">${d.recurring.client_name}</p></div>
  <div><p class="label">Telefone</p><p class="value">${d.recurring.client_phone||'—'}</p></div>
  <div><p class="label">Estabelecimento</p><p class="value">${d.recurring.est_name}</p></div>
  <div><p class="label">Espaço</p><p class="value">${d.recurring.point_name}</p></div>
  <div><p class="label">Dia da semana</p><p class="value">${DOW_LABELS[d.recurring.day_of_week]}</p></div>
  <div><p class="label">Horário</p><p class="value">${d.recurring.start_time} – ${d.recurring.end_time} (${d.recurring.hours}h)</p></div>
  <div><p class="label">Valor por sessão</p><p class="value">${fmtCur(d.price_per_session)}</p></div>
  <div><p class="label">Forma de pagamento</p><p class="value">${PAY_LABEL_MAP[d.recurring.payment_method]||d.recurring.payment_method}</p></div>
</div>
<h3>Sessões do mês (${d.sessions} ${d.sessions===1?'sessão':'sessões'})</h3>
<table>
  <thead><tr><th>#</th><th>Data</th><th>Horário</th><th>Valor</th></tr></thead>
  <tbody>
    ${d.reservations.map((r,i)=>`<tr><td>${i+1}</td><td>${fmtDate(typeof r.date==='string'?r.date:r.date.split('T')[0])}</td><td>${d.recurring.start_time} – ${d.recurring.end_time}</td><td>${fmtCur(d.price_per_session)}</td></tr>`).join('')}
    <tr class="total-row"><td colspan="3">Total</td><td>${fmtCur(d.total)}</td></tr>
  </tbody>
</table>
${d.participantes&&d.participantes.length>0?`
<h3>Divisão entre participantes</h3>
<table>
  <thead><tr><th>Participante</th><th>%</th><th>Valor</th></tr></thead>
  <tbody>
    ${d.participantes.map(p=>`<tr><td>${p.nome}</td><td>${p.percentual}%</td><td>${fmtCur(p.valor)}</td></tr>`).join('')}
  </tbody>
</table>`:''}
${d.dates_skipped&&d.dates_skipped.length>0?`<p style="color:#999;font-size:12px;">⚠ Datas não geradas por conflito: ${d.dates_skipped.map(fmtDate).join(', ')}</p>`:''}
<p style="color:#999;font-size:11px;margin-top:32px;">Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
</body></html>`;
    const w=window.open('','_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(()=>w.print(),400);
  };

  const rnPt=rnPoints.find(p=>String(p.id)===String(rn.pointId));
  const rnTotal=rnPt&&rn.hours?rnPt.price_per_hour*Number(rn.hours):0;

  return<div className="mt-4 space-y-4">
    <div className="flex justify-between items-center">
      <p className="text-sm text-gray-500">Gerencie reservas que se repetem semanalmente. Gere a fatura no fim do mês.</p>
      <Btn onClick={()=>{setShowNew(true);setRn(RNEW);setRnNameInput('');}}>+ Nova Recorrência</Btn>
    </div>

    {loading?<Spinner/>:items.length===0?
      <div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">🔄</p><p>Nenhuma reserva recorrente cadastrada</p></div>
    :<div className="space-y-3">
      {items.map(it=><div key={it.id} className={`bg-white rounded-2xl border p-4 shadow-sm ${it.ativo?'border-gray-100':'border-gray-200 opacity-60'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-bold text-gray-800">{it.client_name}</h3>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${it.ativo?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-500'}`}>{it.ativo?'Ativo':'Pausado'}</span>
            </div>
            <div className="text-sm text-gray-500 space-y-0.5">
              <p>🏢 {it.est_name} — {it.point_name}</p>
              <p>📅 Toda {DOW_LABELS[it.day_of_week]} • {it.start_time} – {it.end_time} ({it.hours}h)</p>
              <p>💰 {fmt$(it.price_per_hour*it.hours)}/semana • {PAY_LABEL[it.payment_method]||it.payment_method}</p>
              {it.client_phone&&<p>📞 {it.client_phone}</p>}
              {Array.isArray(it.participantes)&&it.participantes.length>0&&
                <p>👥 {it.participantes.map(p=>`${p.nome} (${p.percentual}%)`).join(' · ')}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Btn variant="secondary" size="sm" onClick={()=>openInvoice(it)}>📄 Fatura</Btn>
            <Btn variant="secondary" size="sm" onClick={()=>toggleActive(it)}>{it.ativo?'Pausar':'Ativar'}</Btn>
            <Btn variant="danger" size="sm" onClick={()=>removeItem(it)}>Excluir</Btn>
          </div>
        </div>
      </div>)}
    </div>}

    {/* Modal Nova Recorrência */}
    <Modal open={showNew} onClose={resetNew} title="Nova Reserva Recorrente" maxW="max-w-lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 mb-1">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={rn.alunoDoProf} onChange={e=>{updRn('alunoDoProf',e.target.checked);updRn('professorId','');}} className="w-4 h-4 rounded accent-emerald-600"/>
            <span>Aluno é do Professor</span>
          </label>
        </div>
        <Field label="Estabelecimento" required>
          <Sel value={rn.estId} onChange={e=>updRn('estId',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/>
        </Field>
        {rn.alunoDoProf&&<Field label="Professor responsável" required>
          <Sel value={rn.professorId} onChange={e=>updRn('professorId',e.target.value)}
            options={rnProfessores.filter(p=>p.ativo!==false).map(p=>({value:p.id,label:p.nome+(p.percentual_repasse?' (academia '+p.percentual_repasse+'%)':'')}))}
            placeholder={rn.estId?'Selecione o professor...':'Selecione o estabelecimento primeiro'}
            disabled={!rn.estId}/>
        </Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome do cliente" required>
            <div className="relative">
              <Inp value={rnNameInput} onChange={e=>{setRnNameInput(e.target.value);updRn('clientName',e.target.value);setRnShowSugg(true);}} placeholder="Digite para buscar..." onBlur={()=>setTimeout(()=>setRnShowSugg(false),150)} onFocus={()=>{if(rnNameInput)setRnShowSugg(true);}}/>
              {rnShowSugg&&rnSugg.length>0&&<div className="absolute z-50 top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-40 overflow-y-auto">
                {rnSugg.map(a=><button key={a.id} type="button" onMouseDown={()=>selRnAluno(a)} className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-sm border-b border-gray-50 last:border-0">
                  <span className="font-medium">{a.nome}</span>
                  {a.telefone&&<span className="text-gray-400 ml-2 text-xs">{a.telefone}</span>}
                </button>)}
              </div>}
            </div>
          </Field>
          <Field label="Telefone" required>
            <Inp value={rn.clientPhone} onChange={e=>updRn('clientPhone',e.target.value)} placeholder="(00) 00000-0000"/>
          </Field>
        </div>
        <Field label="Email (opcional)">
          <Inp value={rn.clientEmail} onChange={e=>updRn('clientEmail',e.target.value)} placeholder="email@cliente.com"/>
        </Field>
        {rn.estId&&<Field label="Espaço / Ponto" required>
          <Sel value={rn.pointId} onChange={e=>updRn('pointId',e.target.value)} options={rnPoints.map(p=>({value:p.id,label:`${p.name} — ${fmt$(p.price_per_hour)}/h`}))} placeholder="Selecione..."/>
        </Field>}
        <Field label="Dia da semana" required>
          <Sel value={rn.dayOfWeek} onChange={e=>updRn('dayOfWeek',e.target.value)} options={DOW_OPTIONS} placeholder="Selecione..."/>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Início" required>
            <Sel value={rn.startTime} onChange={e=>{updRn('startTime',e.target.value);if(!rn.endTime||rn.endTime<=e.target.value)updRn('endTime','');}} options={rnSlots.map(t=>({value:t,label:t}))} placeholder="—"/>
          </Field>
          <Field label="Fim" required>
            <Sel value={rn.endTime} onChange={e=>updRn('endTime',e.target.value)} options={rnSlots.filter(t=>t>rn.startTime).map(t=>({value:t,label:t}))} placeholder="—"/>
          </Field>
          <Field label="Horas">
            <input type="number" min="1" max="8" value={rn.hours} onChange={e=>updRn('hours',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
          </Field>
        </div>
        {rn.startTime&&rn.endTime&&rnPt&&<div className="bg-emerald-50 rounded-xl p-3 text-sm flex justify-between items-center">
          <span className="text-gray-500">Valor por sessão</span>
          <span className="font-bold text-emerald-700">{fmt$(rnTotal)}</span>
        </div>}
        <Field label="Forma de pagamento">
          <Sel value={rn.pm} onChange={e=>updRn('pm',e.target.value)} options={[{value:'pix',label:'Pix'},{value:'credito',label:'Crédito'},{value:'debito',label:'Débito'},{value:'dinheiro',label:'Dinheiro'}]}/>
        </Field>
        <Field label="Início da recorrência (opcional)">
          <input type="date" value={rn.startDate} min={TODAY} onChange={e=>updRn('startDate',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
        </Field>

        {/* Participantes */}
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">👥 Participantes <span className="text-xs font-normal text-gray-400">(opcional, máx. 4)</span></p>
            {rn.participantes.length<4&&<button onClick={()=>updRn('participantes',[...rn.participantes,{nome:'',percentual:''}])} className="text-xs text-emerald-600 hover:underline font-medium">+ Adicionar</button>}
          </div>
          {rn.participantes.length===0&&<p className="text-xs text-gray-400">Adicione para dividir a fatura entre múltiplos clientes.</p>}
          {rn.participantes.map((p,i)=>{
            const eachPct=rn.participantes.length?Math.round(100/rn.participantes.length):100;
            const pct=Number(p.percentual)||eachPct;
            const valor=rnTotal>0?rnTotal*pct/100:0;
            return<div key={i} className="flex gap-2 items-center">
              <select value={p.nome} onChange={e=>{const np=[...rn.participantes];np[i]={...np[i],nome:e.target.value};updRn('participantes',np);}}
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500">
                <option value="">— Selecione aluno —</option>
                {alunos.map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}
              </select>
              <input type="number" value={p.percentual||eachPct} min="1" max="100"
                onChange={e=>{const np=[...rn.participantes];np[i]={...np[i],percentual:Number(e.target.value)};updRn('participantes',np);}}
                className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="%"/>
              <span className="text-xs text-gray-500 w-20 text-right">{fmt$(valor)}</span>
              <button onClick={()=>updRn('participantes',rn.participantes.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
            </div>;
          })}
        </div>

        <div className="flex gap-3 pt-1">
          <Btn variant="secondary" className="flex-1" onClick={resetNew}>Cancelar</Btn>
          <Btn className="flex-1" disabled={saving} onClick={saveNew}>{saving?'Salvando...':'Criar Recorrência'}</Btn>
        </div>
      </div>
    </Modal>

    {/* Modal Fatura */}
    <Modal open={!!invoiceTarget} onClose={()=>{setInvoiceTarget(null);setInvoiceData(null);}} title="Gerar Fatura Mensal" maxW="max-w-lg">
      {invoiceTarget&&<div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-3 text-sm">
          <p className="font-semibold">{invoiceTarget.client_name}</p>
          <p className="text-gray-500">{invoiceTarget.point_name} • Toda {DOW_LABELS[invoiceTarget.day_of_week]} {invoiceTarget.start_time}–{invoiceTarget.end_time}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mês">
            <Sel value={invoiceMonth} onChange={e=>setInvoiceMonth(Number(e.target.value))} options={MONTH_NAMES.map((n,i)=>({value:i+1,label:n}))}/>
          </Field>
          <Field label="Ano">
            <input type="number" value={invoiceYear} onChange={e=>setInvoiceYear(Number(e.target.value))} min="2024" max="2030" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
          </Field>
        </div>
        <Btn className="w-full" disabled={invoiceLoading} onClick={generateInvoice}>{invoiceLoading?'Gerando...':'Gerar Fatura'}</Btn>

        {invoiceData&&<div className="space-y-3">
          <div className="bg-emerald-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Sessões no mês</span><span className="font-semibold">{invoiceData.sessions}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Valor por sessão</span><span className="font-semibold">{fmt$(invoiceData.price_per_session)}</span></div>
            <div className="flex justify-between font-bold text-emerald-700 pt-2 border-t border-emerald-100 text-base"><span>Total</span><span>{fmt$(invoiceData.total)}</span></div>
          </div>

          {invoiceData.reservations&&invoiceData.reservations.length>0&&<div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Datas</p>
            <div className="flex flex-wrap gap-1.5">
              {invoiceData.reservations.map(r=>{
                const ds=typeof r.date==='string'?r.date:r.date.split('T')[0];
                const[y,m,d]=ds.split('-');
                return<span key={r.id||ds} className="text-xs bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-lg font-medium">{d}/{m}</span>;
              })}
            </div>
          </div>}

          {invoiceData.participantes&&invoiceData.participantes.length>0&&<div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Divisão</p>
            <div className="space-y-1">
              {invoiceData.participantes.map((p,i)=><div key={i} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-700">{p.nome} <span className="text-gray-400">({p.percentual}%)</span></span>
                <span className="font-semibold text-gray-800">{fmt$(p.valor)}</span>
              </div>)}
            </div>
          </div>}

          {invoiceData.dates_skipped&&invoiceData.dates_skipped.length>0&&
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">⚠ {invoiceData.dates_skipped.length} data(s) com conflito não gerada(s)</p>}

          <Btn className="w-full" onClick={printInvoice}>📥 Baixar / Imprimir PDF</Btn>
        </div>}
      </div>}
    </Modal>
  </div>;
}

// ================================================================
// CRM PLANOS DE AULA (aba dentro de Reservas)
// ================================================================
function CRMPlanosAula({showToast}){
  const [planos,setPlanos]=useState([]);
  const [profs,setProfs]=useState([]);
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [editPl,setEditPl]=useState(null);
  const [delPl,setDelPl]=useState(null);
  const [alunosCad,setAlunosCad]=useState([]);
  const BLANK_PL={est_id:'',professor_id:'',nome_aluno:'',telefone_aluno:'',email_aluno:'',tipo_plano:'avulso',valor:'',recorrencia:'nenhuma',dias_semana:[],horario_inicio:'',horario_fim:'',data_inicio:TODAY,data_fim:'',observacoes:''};
  const [f,setF]=useState(BLANK_PL);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));

  const load=()=>{
    Promise.all([planoApi.list(),professorApi.list(),estApi.list(),alunoApi.list()])
      .then(([pl,pr,e,al])=>{setPlanos(pl);setProfs(pr);setEsts(e);setAlunosCad(al);})
      .catch(()=>{})
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);

  const openNew=()=>{setF(BLANK_PL);setEditPl(null);setShowForm(true);};
  const openEdit=(pl)=>{
    setF({est_id:pl.est_id||'',professor_id:pl.professor_id||'',nome_aluno:pl.nome_aluno||'',telefone_aluno:pl.telefone_aluno||'',email_aluno:pl.email_aluno||'',tipo_plano:pl.tipo_plano||'avulso',valor:pl.valor||'',recorrencia:pl.recorrencia||'nenhuma',dias_semana:pl.dias_semana||[],horario_inicio:pl.horario_inicio||'',horario_fim:pl.horario_fim||'',data_inicio:pl.data_inicio?pl.data_inicio.split('T')[0]:TODAY,data_fim:pl.data_fim?pl.data_fim.split('T')[0]:'',observacoes:pl.observacoes||''});
    setEditPl(pl);setShowForm(true);
  };

  const toggleDia=(d)=>setF(p=>({...p,dias_semana:p.dias_semana.includes(d)?p.dias_semana.filter(x=>x!==d):[...p.dias_semana,d]}));

  const save=async()=>{
    if(!f.nome_aluno){showToast('Nome do aluno é obrigatório','error');return;}
    if(!f.tipo_plano){showToast('Tipo de plano é obrigatório','error');return;}
    try{
      const payload={...f,professor_id:f.professor_id||null,est_id:f.est_id||null,valor:parseFloat(f.valor)||0,data_fim:f.data_fim||null};
      if(editPl){await planoApi.update(editPl.id,payload);}else{await planoApi.create(payload);}
      showToast('Plano salvo!','success');setShowForm(false);load();
    }catch(e){showToast(e.message,'error');}
  };

  const cancel=async(pl)=>{
    try{await planoApi.update(pl.id,{...pl,status:'cancelado',professor_id:pl.professor_id||null,est_id:pl.est_id||null,dias_semana:pl.dias_semana||[]});showToast('Plano cancelado','info');load();}
    catch(e){showToast(e.message,'error');}
  };

  const STATUS_COLOR={ativo:'bg-emerald-100 text-emerald-700',cancelado:'bg-red-100 text-red-700',concluido:'bg-gray-100 text-gray-600'};
  const STATUS_LABEL={ativo:'Ativo',cancelado:'Cancelado',concluido:'Concluído'};

  if(loading)return<Spinner/>;

  return<div>
    <div className="flex items-center justify-between mb-5">
      <p className="text-sm text-gray-500">{planos.length} plano{planos.length!==1?'s':''} cadastrado{planos.length!==1?'s':''}</p>
      <Btn onClick={openNew}>+ Novo Plano / Aula</Btn>
    </div>

    {planos.length===0
      ?<div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">📚</p><p>Nenhum plano de aula cadastrado</p></div>
      :<div className="space-y-3">
        {planos.map(pl=><div key={pl.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-bold text-gray-800">{pl.nome_aluno}</h3>
                <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${STATUS_COLOR[pl.status]||'bg-gray-100'}`}>{STATUS_LABEL[pl.status]||pl.status}</span>
                <span className="text-xs bg-blue-100 text-blue-700 font-medium px-2 py-0.5 rounded-full">{TIPO_PLANO_LABEL[pl.tipo_plano]||pl.tipo_plano}</span>
              </div>
              <div className="text-sm text-gray-500 space-y-0.5">
                {pl.professor_nome&&<p>🎓 Prof. {pl.professor_nome}</p>}
                {pl.est_name&&<p>🏢 {pl.est_name}</p>}
                {pl.telefone_aluno&&<p>📞 {pl.telefone_aluno}</p>}
                {(pl.horario_inicio||pl.horario_fim)&&<p>⏰ {pl.horario_inicio}{pl.horario_fim?` – ${pl.horario_fim}`:''}</p>}
                {pl.recorrencia&&pl.recorrencia!=='nenhuma'&&<p>🔁 {RECORRENCIA_LABEL[pl.recorrencia]||pl.recorrencia}{pl.dias_semana?.length?` (${pl.dias_semana.map(d=>d.charAt(0).toUpperCase()+d.slice(1)).join(', ')})`:''}</p>}
                <p>📅 {fmtDate(pl.data_inicio)}{pl.data_fim?` até ${fmtDate(pl.data_fim)}`:''}</p>
                <p className="font-semibold text-emerald-700">💰 {fmt$(pl.valor)}</p>
              </div>
            </div>
            {pl.status==='ativo'&&<div className="flex gap-2 shrink-0">
              <Btn variant="secondary" size="sm" onClick={()=>openEdit(pl)}>Editar</Btn>
              <Btn variant="danger" size="sm" onClick={()=>setDelPl(pl)}>Cancelar</Btn>
            </div>}
          </div>
        </div>)}
      </div>
    }

    {/* Modal Novo/Editar Plano */}
    <Modal open={showForm} onClose={()=>setShowForm(false)} title={editPl?'Editar Plano de Aula':'Novo Plano / Aula'} maxW="max-w-xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estabelecimento"><Sel value={f.est_id} onChange={e=>upd('est_id',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/></Field>
          <Field label="Professor"><Sel value={f.professor_id} onChange={e=>upd('professor_id',e.target.value)} options={profs.map(p=>({value:p.id,label:p.nome}))} placeholder="Selecione..."/></Field>
        </div>
        {alunosCad.length>0&&<Field label="Buscar aluno cadastrado"><Sel value="" onChange={e=>{const a=alunosCad.find(al=>String(al.id)===e.target.value);if(a)setF(p=>({...p,nome_aluno:a.nome,telefone_aluno:a.telefone||'',email_aluno:a.email||''}));}} options={alunosCad.map(a=>({value:a.id,label:a.nome}))} placeholder="Selecione para preencher os dados..."/></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome do Aluno" required><Inp value={f.nome_aluno} onChange={e=>upd('nome_aluno',e.target.value)} placeholder="Nome completo"/></Field>
          <Field label="Telefone do Aluno"><Inp value={f.telefone_aluno} onChange={e=>upd('telefone_aluno',e.target.value)} placeholder="(00) 00000-0000"/></Field>
        </div>
        <Field label="Email do Aluno"><Inp type="email" value={f.email_aluno} onChange={e=>upd('email_aluno',e.target.value)} placeholder="aluno@email.com"/></Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de Plano" required><Sel value={f.tipo_plano} onChange={e=>upd('tipo_plano',e.target.value)} options={TIPO_PLANO_OPTS}/></Field>
          <Field label="Valor (R$)" required help="Informe o valor total do plano"><Inp type="number" value={f.valor} onChange={e=>upd('valor',e.target.value)} placeholder="Ex: 350.00"/></Field>
        </div>

        <Field label="Recorrência"><Sel value={f.recorrencia} onChange={e=>upd('recorrencia',e.target.value)} options={RECORRENCIA_OPTS}/></Field>

        {f.recorrencia!=='nenhuma'&&<Field label="Dias da semana">
          <div className="flex flex-wrap gap-2 mt-1">
            {DAYS.map(d=><button key={d.key} type="button" onClick={()=>toggleDia(d.key)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${f.dias_semana.includes(d.key)?'bg-emerald-600 text-white border-emerald-600':'border-gray-300 text-gray-600 hover:border-emerald-400'}`}>{d.label}</button>)}
          </div>
        </Field>}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Horário início"><input type="time" value={f.horario_inicio} onChange={e=>upd('horario_inicio',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/></Field>
          <Field label="Horário fim"><input type="time" value={f.horario_fim} onChange={e=>upd('horario_fim',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/></Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data início"><input type="date" value={f.data_inicio} onChange={e=>upd('data_inicio',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/></Field>
          <Field label="Data fim (opcional)"><input type="date" value={f.data_fim} onChange={e=>upd('data_fim',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/></Field>
        </div>

        <Field label="Observações"><textarea value={f.observacoes} onChange={e=>upd('observacoes',e.target.value)} rows={2} placeholder="Detalhes adicionais..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"/></Field>

        <div className="flex gap-3 pt-1">
          <Btn variant="secondary" className="flex-1" onClick={()=>setShowForm(false)}>Cancelar</Btn>
          <Btn className="flex-1" onClick={save}>Salvar Plano</Btn>
        </div>
      </div>
    </Modal>

    <Modal open={!!delPl} onClose={()=>setDelPl(null)} title="Cancelar Plano">
      <p className="text-sm text-gray-600 mb-5">Cancelar o plano de <strong>{delPl?.nome_aluno}</strong>?</p>
      <div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setDelPl(null)}>Voltar</Btn><Btn variant="danger" className="flex-1" onClick={()=>{cancel(delPl);setDelPl(null);}}>Confirmar Cancelamento</Btn></div>
    </Modal>
  </div>;
}

// ================================================================
// CRM RESERVA RAPIDA
// ================================================================
function CRMReservaRapida({crmUser,showToast,onClose}){
  const TODAY2=new Date().toISOString().split('T')[0];
  const [ests,setEsts]=useState([]);
  const [points,setPoints]=useState([]);
  const [slots,setSlots]=useState([]);
  const [estId,setEstId]=useState('');
  const [pointId,setPointId]=useState('');
  const [date,setDate]=useState(TODAY2);
  const [selSlots,setSelSlots]=useState([]);
  const [name,setName]=useState('');
  const [phone,setPhone]=useState('');
  const [saving,setSaving]=useState(false);
  const [alunos,setAlunos]=useState([]);
  const [nameInput,setNameInput]=useState('');
  const [showSugg,setShowSugg]=useState(false);
  const sugg=alunos.filter(a=>nameInput.length>1&&a.nome.toLowerCase().includes(nameInput.toLowerCase())).slice(0,6);

  useEffect(()=>{
    Promise.all([estApi.list(),alunoApi.list()]).then(([es,al])=>{
      setEsts(es);setAlunos(al);
      const uid=crmUser?.est_id;
      if(uid)setEstId(String(uid));
      else if(es.length===1)setEstId(String(es[0].id));
    }).catch(()=>{});
  },[]);

  useEffect(()=>{
    if(!estId){setPoints([]);setPointId('');return;}
    pointApi.list(estId).then(setPoints).catch(()=>{});
    setPointId('');
  },[estId]);

  useEffect(()=>{
    if(!pointId||!date){setSlots([]);setSelSlots([]);return;}
    pointApi.slots(pointId,date).then(data=>setSlots(data.filter(x=>x.available).map(x=>x.time))).catch(()=>setSlots([]));
    setSelSlots([]);
  },[pointId,date]);

  const toggleSlot=(s)=>{
    setSelSlots(prev=>{
      if(prev.includes(s)){const idx=prev.indexOf(s);return prev.slice(0,idx);}
      if(prev.length===0||parseInt(s)===parseInt(prev[prev.length-1])+1)return[...prev,s];
      return[s];
    });
  };

  const addDay=(n)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+n);setDate(d.toISOString().split('T')[0]);};
  const fmtD=(d)=>{const dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit'});};

  const selectAluno=(a)=>{setName(a.nome);setNameInput(a.nome);setPhone(a.telefone||'');setShowSugg(false);};

  const save=async()=>{
    if(!pointId){showToast('Selecione uma quadra','error');return;}
    if(!selSlots.length){showToast('Selecione pelo menos 1 horário','error');return;}
    if(!name){showToast('Nome é obrigatório','error');return;}
    if(!phone){showToast('Telefone é obrigatório','error');return;}
    setSaving(true);
    try{
      const s=selSlots[0];
      const e=String(parseInt(selSlots[selSlots.length-1])+1).padStart(2,'0')+':00';
      await resApi.manualCreate({point_id:Number(pointId),est_id:Number(estId),date,start_time:s,end_time:e,hours:selSlots.length,client_name:name,client_phone:phone,payment_method:'pix',professor_id:crmUser?.professor_id||null});
      showToast('Reserva criada com sucesso!','success');
      onClose();
    }catch(e){showToast(e.message,'error');}
    finally{setSaving(false);}
  };

  return<div className="space-y-4">
    {ests.length>1&&<Field label="Estabelecimento" required><Sel value={estId} onChange={e=>setEstId(e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/></Field>}

    {points.length>0&&<div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quadra / Espaço</p>
      <div className="grid grid-cols-2 gap-2">
        {points.map(pt=><button key={pt.id} type="button" onClick={()=>setPointId(String(pt.id))} className={`p-3 rounded-xl border-2 text-sm font-semibold text-left transition-all ${String(pointId)===String(pt.id)?'border-emerald-500 bg-emerald-50 text-emerald-700':'border-gray-200 hover:border-gray-300 text-gray-700'}`}><p>{pt.name}</p><p className="text-xs font-normal opacity-60">{pt.type}</p></button>)}
      </div>
    </div>}
    {estId&&points.length===0&&<p className="text-sm text-gray-400 text-center py-2">Nenhuma quadra cadastrada neste estabelecimento</p>}

    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Data</p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={()=>addDay(-1)} className="w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold text-gray-600">←</button>
        <div className="flex-1 text-center font-semibold text-gray-800 py-2 border border-gray-200 rounded-lg">{fmtD(date)}</div>
        <button type="button" onClick={()=>addDay(1)} className="w-9 h-9 rounded-lg border border-gray-200 hover:bg-gray-50 font-bold text-gray-600">→</button>
      </div>
    </div>

    {pointId&&slots.length>0&&<div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Horário {selSlots.length>0&&<span className="text-emerald-600 normal-case font-medium">— {selSlots[0]} a {String(parseInt(selSlots[selSlots.length-1])+1).padStart(2,'0')}:00 ({selSlots.length}h)</span>}</p>
      <div className="flex flex-wrap gap-1.5">
        {slots.map(s=><button key={s} type="button" onClick={()=>toggleSlot(s)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${selSlots.includes(s)?'bg-emerald-600 text-white border-emerald-600':'border-gray-200 text-gray-600 hover:border-emerald-400'}`}>{s}</button>)}
      </div>
    </div>}
    {pointId&&date&&slots.length===0&&<p className="text-sm text-amber-500 text-center py-2 bg-amber-50 rounded-lg">Nenhum horário livre neste dia</p>}

    <div className="relative">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cliente</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="relative">
          <Inp value={nameInput} onChange={e=>{setNameInput(e.target.value);setName(e.target.value);setShowSugg(true);}} placeholder="Nome" onBlur={()=>setTimeout(()=>setShowSugg(false),150)}/>
          {showSugg&&sugg.length>0&&<div className="absolute z-50 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 overflow-hidden">
            {sugg.map(a=><button key={a.id} type="button" onMouseDown={()=>selectAluno(a)} className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 text-gray-700">{a.nome}{a.telefone&&<span className="text-xs text-gray-400 ml-2">{a.telefone}</span>}</button>)}
          </div>}
        </div>
        <Inp type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Telefone"/>
      </div>
    </div>

    <Btn className="w-full !py-3 text-base" onClick={save} disabled={saving}>
      {saving?'Criando...':'✅ Confirmar Reserva'}
    </Btn>
  </div>;
}

// ================================================================
// CRM RESERVATIONS
// ================================================================
function CRMReservations({showToast,crmUser}){
  const [reservations,setReservations]=useState([]);
  const [loading,setLoading]=useState(true);
  const [dateF,setDateF]=useState(TODAY);
  const [statusF,setStatusF]=useState('');
  const [reschRes,setReschRes]=useState(null);
  const [newDate,setNewDate]=useState('');
  const [newSlots,setNewSlots]=useState([]);
  const [rSlots,setRSlots]=useState([]);

  // ── Nova reserva manual ──
  const [showManual,setShowManual]=useState(false);
  const [showRapida,setShowRapida]=useState(false);
  const MBL={name:'',phone:'',email:'',estId:'',pointId:'',date:TODAY,slots:[],pm:'dinheiro',participantes:[],pricePerHour:'',professorId:'',alunoDoProf:false};
  const [mb,setMb]=useState(MBL);
  const [mbAlunos,setMbAlunos]=useState([]);
  const [mbEsts,setMbEsts]=useState([]);
  const [mbPoints,setMbPoints]=useState([]);
  const [mbSlots,setMbSlots]=useState([]);
  const [mbSaving,setMbSaving]=useState(false);
  const [mbProfessores,setMbProfessores]=useState([]);
  const updMb=(k,v)=>setMb(m=>({...m,[k]:v}));
  const [mbNameInput,setMbNameInput]=useState('');
  const [mbShowSugg,setMbShowSugg]=useState(false);
  const [mbVisitante,setMbVisitante]=useState(false);
  const mbSugg=mbAlunos.filter(a=>mbNameInput.length>0&&a.nome.toLowerCase().includes(mbNameInput.toLowerCase())).slice(0,8);
  const selectMbAluno=(a)=>{setMb(m=>({...m,name:a.nome,phone:a.telefone||'',email:a.email||''}));setMbNameInput(a.nome);setMbShowSugg(false);};
  const resetMbModal=()=>{setShowManual(false);setMb(MBL);setMbNameInput('');setMbShowSugg(false);setMbVisitante(false);};

  const load=useCallback(()=>{
    const params={};
    if(dateF)params.date=dateF;
    if(statusF)params.status=statusF;
    resApi.list(params).then(setReservations).catch(()=>{}).finally(()=>setLoading(false));
  },[dateF,statusF]);
  useEffect(()=>{load();},[load]);

  useEffect(()=>{
    if(!reschRes||!newDate)return;
    pointApi.slots(reschRes.point_id,newDate).then(setRSlots).catch(()=>setRSlots([]));
    setNewSlots([]);
  },[reschRes,newDate]);

  // Carrega ests/points para modal manual
  useEffect(()=>{
    if(!showManual)return;
    estApi.list().then(ests=>{
      setMbEsts(ests);
      // Default para o estabelecimento do usuário logado
      if(!mb.estId){
        const userEstId=crmUser?.est_id||(crmUser?.est_ids&&crmUser.est_ids[0]);
        if(userEstId)updMb('estId',String(userEstId));
      }
    }).catch(()=>{});
    alunoApi.list().then(setMbAlunos).catch(()=>{});
  },[showManual]);
  useEffect(()=>{
    if(!mb.estId){setMbPoints([]);setMbProfessores([]);updMb('pointId','');return;}
    pointApi.list(mb.estId).then(setMbPoints).catch(()=>{});
    professorApi.list(mb.estId).then(setMbProfessores).catch(()=>{});
    updMb('pointId','');
  },[mb.estId]);
  useEffect(()=>{
    if(!mb.pointId||!mb.date){setMbSlots([]);updMb('slots',[]);return;}
    pointApi.slots(mb.pointId,mb.date).then(setMbSlots).catch(()=>setMbSlots([]));
    updMb('slots',[]);
  },[mb.pointId,mb.date]);
  // Preenche valor/hora padrão do ponto ao selecioná-lo
  useEffect(()=>{
    if(!mb.pointId){updMb('pricePerHour','');return;}
    const pt=mbPoints.find(p=>String(p.id)===String(mb.pointId));
    if(pt)updMb('pricePerHour',pt.price_per_hour);
  },[mb.pointId,mbPoints]);



  const toggleMbSlot=(s)=>{
    if(!s.available)return;
    setMb(m=>{
      const prev=m.slots;
      const next=prev.includes(s.time)?prev.filter(t=>t!==s.time):[...prev,s.time].sort();
      for(let i=1;i<next.length;i++){if(parseInt(next[i])-parseInt(next[i-1])!==1)return m;}
      return{...m,slots:next};
    });
  };

  const saveManual=async()=>{
    if(mbVisitante){
      if(!mb.phone||!mb.estId){showToast('Telefone e estabelecimento são obrigatórios','error');return;}
    } else {
      if(!mb.name||!mb.phone||!mb.estId){showToast('Nome, telefone e estabelecimento são obrigatórios','error');return;}
    }
    const clientName=mbVisitante?(mb.name.trim()||'Visitante'):mb.name;
    const s=mb.slots.length?mb.slots[0]:undefined;
    const e=mb.slots.length?`${String(parseInt(mb.slots[mb.slots.length-1])+1).padStart(2,'0')}:00`:undefined;
    setMbSaving(true);
    try{
      await resApi.manualCreate({
        point_id:mb.pointId?Number(mb.pointId):undefined,est_id:Number(mb.estId),
        date:mb.date||undefined,start_time:s,end_time:e,hours:mb.slots.length||undefined,
        payment_method:mb.pm,client_name:clientName,client_phone:mb.phone,client_email:mb.email||undefined,
        participantes:mb.participantes.filter(p=>p.nome),
        price_per_hour:mb.pricePerHour!==''?Number(mb.pricePerHour):undefined,
        professor_id:mb.alunoDoProf&&mb.professorId?Number(mb.professorId):undefined,
      });
      showToast('Reserva criada com sucesso!','success');
      resetMbModal();load();
    }catch(err){showToast(err.message,'error');}finally{setMbSaving(false);}
  };

  const toggleSlot=(s)=>{
    if(!s.available)return;
    setNewSlots(prev=>{
      const next=prev.includes(s.time)?prev.filter(t=>t!==s.time):[...prev,s.time].sort();
      for(let i=1;i<next.length;i++){if(parseInt(next[i].split(':')[0])-parseInt(next[i-1].split(':')[0])!==1)return prev;}
      return next;
    });
  };

  const handleCancel=async(id)=>{
    try{await resApi.cancel(id);showToast('Reserva cancelada','success');load();}
    catch(e){showToast(e.message,'error');}
  };
  const handleDelete=async(id)=>{
    if(!window.confirm('Excluir esta reserva permanentemente?'))return;
    try{await resApi.remove(id);showToast('Reserva excluída','info');load();}
    catch(e){showToast(e.message,'error');}
  };

  const handleReschedule=async()=>{
    const ns=newSlots[0];
    const ne=`${String(parseInt(newSlots[newSlots.length-1].split(':')[0])+1).padStart(2,'00')}:00`;
    try{await resApi.reschedule(reschRes.id,newDate,ns,ne,newSlots.length);showToast('Remarcada!','success');setReschRes(null);load();}
    catch(e){showToast(e.message,'error');}
  };

  const dateStr=r=>typeof r.date==='string'?r.date:r.date.toISOString().split('T')[0];
  const PAY_OPTS=[{value:'pix',label:'Pix'},{value:'credito',label:'Crédito'},{value:'debito',label:'Débito'},{value:'dinheiro',label:'Dinheiro'}];

  const mbStartT=mb.slots[0]||'';
  const mbEndT=mb.slots.length?`${String(parseInt(mb.slots[mb.slots.length-1])+1).padStart(2,'0')}:00`:'';
  const mbPt=mbPoints.find(p=>String(p.id)===String(mb.pointId));
  const mbEffectivePrice=mb.pricePerHour!==''?Number(mb.pricePerHour):(mbPt?.price_per_hour||0);
  const mbTotal=mbEffectivePrice*mb.slots.length;
  const mbPriceOverridden=mbPt&&Number(mb.pricePerHour)!==mbPt.price_per_hour;

  const [resTab,setResTab]=useState('reservas');

  return<div className="p-6">
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-2xl font-black text-gray-900">Gestão de Reservas</h1>
      {resTab==='reservas'&&<div className="flex gap-2">
        <Btn variant="secondary" onClick={()=>setShowRapida(true)}>🚀 Reserva Rápida</Btn>
        <Btn onClick={()=>{setShowManual(true);setMb(MBL);setMbNameInput('');setMbVisitante(false);}}>+ Nova Reserva</Btn>
      </div>}
    </div>
    <Tabs tabs={[{key:'reservas',label:'📅 Reservas de Espaço'},{key:'recorrentes',label:'🔄 Recorrentes'},{key:'aulas',label:'📚 Planos de Aula'},{key:'bar',label:'🍺 Bar'},{key:'manutencao',label:'🛒 Loja & Equipamentos'}]} active={resTab} onChange={setResTab}/>
    {resTab==='aulas'&&<CRMPlanosAula showToast={showToast}/>}
    {resTab==='recorrentes'&&<CRMRecorrentes showToast={showToast} crmUser={crmUser}/>}
    {resTab==='bar'&&<CRMBar showToast={showToast} crmUser={crmUser}/>}
    {resTab==='manutencao'&&<CRMManutencao showToast={showToast} crmUser={crmUser}/>}
    {resTab==='reservas'&&<div>
    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 flex flex-wrap gap-4 items-end">
      <div><p className="text-xs text-gray-400 mb-1 font-medium">Data</p><input type="date" value={dateF} onChange={e=>{setDateF(e.target.value);setLoading(true);}} className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/></div>
      <div><p className="text-xs text-gray-400 mb-1 font-medium">Status</p><Sel value={statusF} onChange={e=>{setStatusF(e.target.value);setLoading(true);}} options={[{value:'confirmed',label:'Confirmada'},{value:'cancelled',label:'Cancelada'},{value:'completed',label:'Concluída'}]} placeholder="Todos"/></div>
      <Btn variant="secondary" size="sm" onClick={()=>{setDateF('');setStatusF('');}}>Limpar</Btn>
    </div>
    {loading?<Spinner/>:<div className="space-y-3">
      {reservations.length===0&&<div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">📭</p><p>Nenhuma reserva encontrada</p></div>}
      {reservations.map(r=><div key={r.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <h3 className="font-bold text-gray-800">{r.point_name}</h3>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColor(r.status)}`}>{statusLabel(r.status)}</span>
            </div>
            <div className="text-sm text-gray-500 space-y-0.5">
              <p>🏢 {r.est_name}</p>
              <p>👤 {r.user_name} — {r.user_email}</p>
              <p>📅 {fmtDate(dateStr(r))} • {r.start_time} – {r.end_time} ({r.hours}h)</p>
              <p>💰 {fmt$(r.total)} {r.payment_method?`• ${PAY_LABEL[r.payment_method]||r.payment_method}`:''}</p>
              {r.professor_nome&&<p className="text-amber-600">🎓 Prof. {r.professor_nome}{r.percentual_repasse?` — academia ${r.percentual_repasse}% = ${fmt$(r.total*r.percentual_repasse/100)}`:''}</p>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            {r.status==='confirmed'&&<><Btn variant="secondary" size="sm" onClick={()=>{setReschRes(r);setNewDate('');setNewSlots([]);}}>Remarcar</Btn>
            <Btn variant="danger" size="sm" onClick={()=>handleCancel(r.id)}>Cancelar</Btn></>}
            <Btn variant="danger" size="sm" onClick={()=>handleDelete(r.id)}>Excluir</Btn>
          </div>
        </div>
      </div>)}
    </div>}

    {/* Modal Remarcar */}
    <Modal open={!!reschRes} onClose={()=>setReschRes(null)} title="Remarcar Reserva">{reschRes&&<div className="space-y-4"><div className="bg-gray-50 rounded-xl p-3 text-sm"><p className="font-semibold">{reschRes.point_name}</p><p className="text-gray-500">Atual: {fmtDate(dateStr(reschRes))} • {reschRes.start_time}–{reschRes.end_time}</p></div><Field label="Nova data"><input type="date" value={newDate} onChange={e=>{setNewDate(e.target.value);setNewSlots([]);}} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/></Field>{newDate&&<div><p className="text-sm font-medium text-gray-700 mb-2">Novo horário</p><div className="grid grid-cols-4 gap-1.5">{rSlots.map(s=><button key={s.time} onClick={()=>toggleSlot(s)} disabled={!s.available} className={`py-2 text-xs rounded-lg border font-medium ${newSlots.includes(s.time)?'bg-emerald-600 text-white border-emerald-600':s.available?'border-gray-300 hover:border-emerald-400 text-gray-700':'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'}`}>{s.time}</button>)}</div></div>}<div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setReschRes(null)}>Cancelar</Btn><Btn className="flex-1" disabled={!newDate||!newSlots.length} onClick={handleReschedule}>Confirmar</Btn></div></div>}</Modal>

    {/* Modal Reserva Rápida */}
    <Modal open={showRapida} onClose={()=>setShowRapida(false)} title="🚀 Reserva Rápida" maxW="max-w-lg">
      {showRapida&&<CRMReservaRapida crmUser={crmUser} showToast={showToast} onClose={()=>{setShowRapida(false);load();}}/>}
    </Modal>
    {/* Modal Nova Reserva Manual */}
    <Modal open={showManual} onClose={()=>resetMbModal()} title="Nova Reserva Manual" maxW="max-w-lg">
      <div className="space-y-4">
        {/* Checkbox Visitante */}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={mbVisitante} onChange={e=>{setMbVisitante(e.target.checked);updMb('name','');updMb('phone','');setMbNameInput('');setMbShowSugg(false);}} className="w-4 h-4 rounded accent-emerald-600"/>
            <span>Visitante <span className="text-gray-400 text-xs">(sem cadastro)</span></span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={mb.alunoDoProf} onChange={e=>{updMb('alunoDoProf',e.target.checked);updMb('professorId','');}} className="w-4 h-4 rounded accent-emerald-600"/>
            <span>Aluno é do Professor</span>
          </label>
        </div>
        <Field label="Estabelecimento" required>
          <Sel value={mb.estId} onChange={e=>updMb('estId',e.target.value)} options={mbEsts.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/>
        </Field>
        {mb.alunoDoProf&&<Field label="Professor responsável" required>
          <Sel value={mb.professorId} onChange={e=>updMb('professorId',e.target.value)}
            options={mbProfessores.filter(p=>p.ativo!==false).map(p=>({value:p.id,label:p.nome+(p.percentual_repasse?' (academia '+p.percentual_repasse+'%)':'')}))}
            placeholder={mb.estId?'Selecione o professor...':'Selecione o estabelecimento primeiro'}
            disabled={!mb.estId}/>
        </Field>}
        <div className="grid grid-cols-2 gap-3">
          {mbVisitante?(
            <Field label="Nome (opcional)">
              <Inp value={mb.name} onChange={e=>updMb('name',e.target.value)} placeholder="João Silva"/>
            </Field>
          ):(
            <Field label="Nome completo" required>
              <div className="relative">
                <Inp value={mbNameInput} onChange={e=>{setMbNameInput(e.target.value);updMb('name',e.target.value);setMbShowSugg(true);}} placeholder="Digite para buscar..." onBlur={()=>setTimeout(()=>setMbShowSugg(false),150)} onFocus={()=>{if(mbNameInput)setMbShowSugg(true);}}/>
                {mbShowSugg&&mbSugg.length>0&&<div className="absolute z-50 top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {mbSugg.map(a=><button key={a.id} type="button" onMouseDown={()=>selectMbAluno(a)} className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-sm border-b border-gray-50 last:border-0">
                    <span className="font-medium text-gray-800">{a.nome}</span>
                    {a.telefone&&<span className="text-gray-400 ml-2 text-xs">{a.telefone}</span>}
                  </button>)}
                </div>}
              </div>
            </Field>
          )}
          <Field label="Telefone" required>
            <Inp value={mb.phone} onChange={e=>updMb('phone',e.target.value)} placeholder="(00) 00000-0000"/>
          </Field>
        </div>
        <Field label="Email (opcional)">
          <Inp value={mb.email} onChange={e=>updMb('email',e.target.value)} placeholder="email@cliente.com"/>
        </Field>
        <Field label="Ponto / Espaço">
          <Sel value={mb.pointId} onChange={e=>updMb('pointId',e.target.value)} options={mbPoints.map(p=>({value:p.id,label:p.name}))} placeholder={mb.estId?'Selecione...':'Selecione o estabelecimento primeiro'} disabled={!mb.estId}/>
        </Field>
        <Field label="Data (opcional)">
          <input type="date" value={mb.date} onChange={e=>updMb('date',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
        </Field>
        {mb.date&&mb.pointId&&<div>
          <p className="text-sm font-medium text-gray-700 mb-2">Horários disponíveis <span className="text-xs font-normal text-gray-400">(opcional)</span></p>
          {mbSlots.length===0?<p className="text-sm text-gray-400 text-center py-3">Nenhum horário disponível</p>
          :<div className="grid grid-cols-4 gap-1.5">
            {mbSlots.map(s=><button key={s.time} onClick={()=>toggleMbSlot(s)} disabled={!s.available} className={`py-2 text-xs rounded-lg border font-medium ${mb.slots.includes(s.time)?'bg-emerald-600 text-white border-emerald-600':s.available?'border-gray-300 hover:border-emerald-400 text-gray-700':'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'}`}>{s.time}</button>)}
          </div>}
        </div>}
        <div className="bg-emerald-50 rounded-xl p-3 text-sm space-y-2">
          {mb.slots.length>0&&<><div className="flex justify-between"><span className="text-gray-500">Período</span><span className="font-medium">{mbStartT} – {mbEndT}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Duração</span><span className="font-medium">{mb.slots.length}h</span></div></>}
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Valor/hora{mbPriceOverridden&&<span className="ml-1 text-xs text-amber-600 font-normal">(ajustado)</span>}</span>
            <div className="flex items-center gap-1">
              <span className="text-gray-400 text-xs">R$</span>
              <input type="number" min="0" step="0.01" value={mb.pricePerHour} onChange={e=>updMb('pricePerHour',e.target.value)} placeholder="0,00"
                className="w-24 text-right border border-emerald-200 rounded-lg px-2 py-0.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium"/>
            </div>
          </div>
          {mb.slots.length>0&&<div className="flex justify-between font-bold text-emerald-700 pt-1 border-t border-emerald-100 text-base"><span>Total</span><span>{fmt$(mbTotal)}</span></div>}
        </div>
        {/* Participantes em grupo */}
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">👥 Participantes em grupo <span className="text-xs font-normal text-gray-400">(opcional, máx. 4)</span></p>
            {mb.participantes.length<4&&<button onClick={()=>updMb('participantes',[...mb.participantes,{nome:'',percentual:''}])} className="text-xs text-emerald-600 hover:underline font-medium">+ Adicionar</button>}
          </div>
          {mb.participantes.length===0&&<p className="text-xs text-gray-400">Sem participantes (reserva individual). Adicione para dividir a cobrança.</p>}
          {mb.participantes.map((p,i)=>{
            const eachPct=mb.participantes.length?Math.round(100/mb.participantes.length):100;
            const pct=Number(p.percentual)||eachPct;
            const valor=mbTotal>0?mbTotal*pct/100:0;
            return<div key={i} className="flex gap-2 items-center">
              <select value={p.nome} onChange={e=>{const np=[...mb.participantes];np[i]={...np[i],nome:e.target.value};updMb('participantes',np);}}
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500">
                <option value="">— Selecione aluno —</option>
                {mbAlunos.map(a=><option key={a.id} value={a.nome}>{a.nome}</option>)}
              </select>
              <input type="number" value={p.percentual||eachPct} min="1" max="100"
                onChange={e=>{const np=[...mb.participantes];np[i]={...np[i],percentual:Number(e.target.value)};updMb('participantes',np);}}
                className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="%"/>
              <span className="text-xs text-gray-500 w-20 text-right">{fmt$(valor)}</span>
              <button onClick={()=>updMb('participantes',mb.participantes.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
            </div>;
          })}
          {mb.participantes.length>0&&<p className="text-xs text-gray-400">Total distribuído: {mb.participantes.reduce((s,p)=>s+(Number(p.percentual)||Math.round(100/mb.participantes.length)),0)}%</p>}
        </div>

        <div className="flex gap-3 pt-1">
          <Btn variant="secondary" className="flex-1" onClick={()=>resetMbModal()}>Cancelar</Btn>
          <Btn className="flex-1" disabled={mbSaving||(!mbVisitante&&!mb.name)||!mb.phone||!mb.estId} onClick={saveManual}>{mbSaving?'Salvando...':'Confirmar Reserva'}</Btn>
        </div>
      </div>
    </Modal>
  </div>}
  </div>;
}

// ================================================================
// ================================================================
// CRM BAR
// ================================================================
function VendasForm({titulo,labelItem,onSave,alunos=[],loading,showFoto=false}){
  // Modo avulso (cliente não cadastrado) ou busca de aluno
  const [avulso,setAvulso]=useState(false);
  const [avulsoNome,setAvulsoNome]=useState('');
  // Busca de aluno cadastrado
  const [alunoInput,setAlunoInput]=useState('');
  const [alunoSel,setAlunoSel]=useState(null);  // {id,nome,est_name}
  const [showSugg,setShowSugg]=useState(false);
  // Itens / totais
  const [itens,setItens]=useState([{nome:'',quantidade:1,valor_unitario:''}]);
  const [obs,setObs]=useState('');
  const [dataVenda,setDataVenda]=useState(TODAY);
  const [foto,setFoto]=useState(null);
  const [saving,setSaving]=useState(false);

  const sugg=alunos.filter(a=>alunoInput.length>0&&a.nome.toLowerCase().includes(alunoInput.toLowerCase())).slice(0,10);

  const selAluno=(a)=>{setAlunoSel(a);setAlunoInput(a.nome);setShowSugg(false);};
  const clearAluno=()=>{setAlunoSel(null);setAlunoInput('');};
  const toggleAvulso=(v)=>{setAvulso(v);clearAluno();setAvulsoNome('');};

  const addItem=()=>setItens(p=>[...p,{nome:'',quantidade:1,valor_unitario:''}]);
  const rmItem=(i)=>setItens(p=>p.filter((_,j)=>j!==i));
  const updItem=(i,k,v)=>setItens(p=>p.map((it,j)=>j===i?{...it,[k]:v}:it));
  const total=itens.reduce((s,i)=>s+(Number(i.quantidade)||0)*(Number(i.valor_unitario)||0),0);

  const handleFotoChange=async(e)=>{
    const file=e.target.files?.[0];if(!file)return;
    const compressed=await compressImage(file,1920,0.88);setFoto(compressed);
  };

  const save=async()=>{
    const nome=avulso?avulsoNome.trim():(alunoSel?.nome||alunoInput.trim());
    if(!nome){alert(avulso?'Informe o nome do cliente avulso':'Selecione um aluno cadastrado');return;}
    if(!itens[0].nome){alert('Informe ao menos um item');return;}
    setSaving(true);
    try{
      await onSave({
        cliente_nome:nome,
        aluno_id:avulso?null:(alunoSel?._tipo==='professor'?null:(alunoSel?.id||null)),
        cliente_ref:avulso?'avulso':(alunoSel?._tipo==='professor'?'professor':'aluno'),
        itens:itens.map(i=>({...i,quantidade:Number(i.quantidade),valor_unitario:Number(i.valor_unitario)})),
        observacoes:obs,data_venda:dataVenda,foto:foto||null,
      });
      clearAluno();setAvulsoNome('');setAvulso(false);
      setItens([{nome:'',quantidade:1,valor_unitario:''}]);setObs('');setDataVenda(TODAY);setFoto(null);
    }finally{setSaving(false);}
  };

  if(loading)return<Spinner/>;
  return<div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 max-w-2xl">
    <h2 className="font-bold text-gray-700">{titulo}</h2>

    {/* Cliente / Aluno */}
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {avulso?'Nome do Cliente Avulso':'Aluno / Professor Cadastrado'} <span className="text-red-500">*</span>
      </label>

      {avulso
        ?<input value={avulsoNome} onChange={e=>setAvulsoNome(e.target.value)} placeholder="Nome do cliente avulso..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
        :<div className="relative">
          <input
            value={alunoSel?alunoSel.nome:alunoInput}
            onChange={e=>{setAlunoInput(e.target.value);setAlunoSel(null);setShowSugg(true);}}
            onFocus={()=>setShowSugg(true)}
            onBlur={()=>setTimeout(()=>setShowSugg(false),150)}
            placeholder="Buscar aluno cadastrado..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 pr-8"/>
          {(alunoSel||alunoInput)&&<button onClick={clearAluno} className="absolute right-2 top-2.5 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>}
          {showSugg&&sugg.length>0&&
            <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
              {sugg.map((a,i)=><div key={`${a._tipo||'aluno'}-${i}`} onMouseDown={()=>selAluno(a)} className="px-3 py-2 text-sm hover:bg-emerald-50 cursor-pointer flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {a._tipo==='professor'&&<span className="text-xs text-indigo-500 font-semibold mr-1">🎓</span>}
                  <span className="font-medium text-gray-800">{a.nome}</span>
                </div>
                {a.est_name&&<span className="text-xs text-gray-400 ml-2">{a.est_name}</span>}
              </div>)}
            </div>}
          {showSugg&&alunoInput.length>0&&sugg.length===0&&
            <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 px-3 py-2 text-sm text-gray-400">Nenhum aluno encontrado</div>}
        </div>}

      {/* Checkbox avulso */}
      <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
        <input type="checkbox" checked={avulso} onChange={e=>toggleAvulso(e.target.checked)} className="w-4 h-4 accent-emerald-600 rounded"/>
        <span className="text-sm text-gray-500">Venda avulsa <span className="text-gray-400">(cliente não cadastrado)</span></span>
      </label>
    </div>

    {/* Itens */}
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700">{labelItem}</label>
        <button onClick={addItem} className="text-xs text-emerald-600 hover:underline font-medium">+ Adicionar item</button>
      </div>
      <div className="space-y-2">
        {itens.map((it,i)=><div key={i} className="flex gap-2 items-center">
          <input value={it.nome} onChange={e=>updItem(i,'nome',e.target.value)} placeholder="Nome do item" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
          <input type="number" value={it.quantidade} onChange={e=>updItem(i,'quantidade',e.target.value)} min="1" placeholder="Qtd" className="w-16 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-center"/>
          <input type="number" value={it.valor_unitario} onChange={e=>updItem(i,'valor_unitario',e.target.value)} min="0" step="0.01" placeholder="R$/un" className="w-24 border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
          <span className="text-xs font-semibold text-gray-700 w-20 text-right">{fmt$((Number(it.quantidade)||0)*(Number(it.valor_unitario)||0))}</span>
          {itens.length>1&&<button onClick={()=>rmItem(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>}
        </div>)}
      </div>
      <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
        <span className="text-sm font-bold text-gray-700">Total</span>
        <span className="text-lg font-black text-emerald-700">{fmt$(total)}</span>
      </div>
    </div>

    <div className="flex gap-4">
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-1">Data da venda</label>
        <input type="date" value={dataVenda} onChange={e=>setDataVenda(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
      </div>
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
        <textarea value={obs} onChange={e=>setObs(e.target.value)} rows={1} placeholder="Opcional..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"/>
      </div>
    </div>

    {showFoto&&<div>
      <label className="block text-sm font-medium text-gray-700 mb-1">📷 Foto (comprovante / registro)</label>
      <input type="file" accept="image/*" onChange={handleFotoChange} className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"/>
      {foto&&<img src={foto} alt="preview" className="mt-2 h-24 rounded-lg object-cover border border-gray-200"/>}
    </div>}

    <Btn onClick={save} disabled={saving} className="w-full">{saving?'Salvando...':'💾 Registrar'}</Btn>
  </div>;
}

function VendasList({rows,onDelete,tipo}){
  if(!rows.length)return<div className="text-center py-12 text-gray-400"><p className="text-3xl mb-2">{tipo==='bar'?'🍺':'🔧'}</p><p>Nenhum registro encontrado</p></div>;
  return<div className="space-y-2 mt-4">
    {rows.map(v=><div key={v.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-start justify-between gap-3 shadow-sm">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-bold text-gray-800">{v.cliente_nome}</span>
          {v.est_name&&<span className="text-xs text-gray-400">• {v.est_name}</span>}
          <span className="text-xs text-gray-400 ml-auto">{v.data_venda ? fmtDate(v.data_venda) : new Date(v.created_at).toLocaleDateString('pt-BR')}</span>
        </div>
        <div className="text-xs text-gray-500 space-y-0.5">
          {(v.itens||[]).map((it,i)=><p key={i}>{it.nome} × {it.quantidade} = {fmt$(it.quantidade*it.valor_unitario)}</p>)}
        </div>
        <p className="text-sm font-bold text-emerald-700 mt-1">Total: {fmt$(v.total)}</p>
        {v.observacoes&&<p className="text-xs text-gray-400 mt-0.5 italic">{v.observacoes}</p>}
      </div>
      <Btn variant="danger" size="sm" onClick={()=>onDelete(v.id)}>Excluir</Btn>
    </div>)}
  </div>;
}

// ================================================================
// CRM ALUNOS
// ================================================================
function CRMAlunos({crmUser,showToast}){
  const [alunos,setAlunos]=useState([]);
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [editA,setEditA]=useState(null);
  const [delA,setDelA]=useState(null);
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const PAGE_SIZE=20;
  const BLANK={nome:'',cpf:'',email:'',telefone:'',data_nascimento:'',est_id:'',professor_id:''};
  const [f,setF]=useState(BLANK);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));

  const [profs,setProfs]=useState([]);
  const isProfessor=crmUser?.role==='professor';
  const load=()=>{
    Promise.all([alunoApi.list(),estApi.list(),professorApi.list()])
      .then(([a,e,pr])=>{setAlunos(a);setEsts(e);setProfs(pr);})
      .catch(()=>{})
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);

  const isSimples=crmUser?.role==='simples';
  const isManager=crmUser?.role==='manager';
  const defaultProfId=isProfessor?(crmUser?.professor_id||''):'';
  const defaultEstId=(isSimples||isProfessor||isManager)?(crmUser?.est_id||''):'';
  const openNew=()=>{setF({...BLANK,est_id:defaultEstId,professor_id:defaultProfId}); setEditA(null);setShowForm(true);};
  const openEdit=(a)=>{
    setF({nome:a.nome||'',cpf:a.cpf||'',email:a.email||'',telefone:a.telefone||'',
          data_nascimento:a.data_nascimento?a.data_nascimento.split('T')[0]:'',
          est_id:a.est_id||'',professor_id:a.professor_id||defaultProfId});
    setEditA(a);setShowForm(true);
  };

  const save=async()=>{
    if(!f.nome){showToast('Nome é obrigatório','error');return;}
    try{
      const payload={...f,est_id:f.est_id||null,data_nascimento:f.data_nascimento||null,professor_id:f.professor_id||null};
      if(editA){
        const updated=await alunoApi.update(editA.id,payload);
        setAlunos(prev=>prev.map(a=>a.id===editA.id?{...a,...updated}:a));
      } else {
        const created=await alunoApi.create(payload);
        setAlunos(prev=>[...prev,created].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR')));
      }
      showToast('Aluno salvo!','success');setShowForm(false);
    }catch(e){console.error('[CRMAlunos save]',e);showToast(e.message||'Erro ao salvar aluno','error');}
  };

  const del=async()=>{
    try{
      await alunoApi.remove(delA.id);
      setAlunos(prev=>prev.filter(a=>a.id!==delA.id));
      showToast('Aluno removido','info');setDelA(null);
    }catch(e){showToast(e.message,'error');}
  };

  if(loading)return<Spinner/>;

  return<div className="p-6 max-w-5xl">
    <div className="flex items-center justify-between mb-6">
      <div><h1 className="text-2xl font-black text-gray-900">Alunos / Clientes</h1>
      <p className="text-sm text-gray-400">{alunos.length} aluno{alunos.length!==1?'s':''} cadastrado{alunos.length!==1?'s':''}</p></div>
      <Btn onClick={openNew}>+ Novo Aluno</Btn>
    </div>

    {/* Search box */}
    <div className="mb-4">
      <Inp value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="🔍 Filtrar por nome..."/>
    </div>

    {(()=>{
      const filtered=alunos.filter(a=>!search||a.nome.toLowerCase().includes(search.toLowerCase()));
      const totalPages=Math.ceil(filtered.length/PAGE_SIZE);
      const paged=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
      if(alunos.length===0)return<div className="text-center py-20 text-gray-400"><p className="text-5xl mb-3">🎽</p><p className="text-lg">Nenhum aluno cadastrado</p><Btn className="mt-5" onClick={openNew}>+ Cadastrar primeiro aluno</Btn></div>;
      return<>
        {filtered.length===0?<div className="text-center py-12 text-gray-400"><p className="text-3xl mb-2">🔍</p><p>Nenhum aluno encontrado para "{search}"</p></div>:<>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>{['Nome','CPF','Email','Telefone','Aniversário','Estabelecimento','Ações'].map(h=><th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h==='Ações'?'text-right':''}`}>{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map(a=><tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">{a.nome}</td>
                  <td className="px-4 py-3 text-gray-500">{a.cpf||'—'}</td>
                  <td className="px-4 py-3 text-gray-500">{a.email||'—'}</td>
                  <td className="px-4 py-3 text-gray-500">{a.telefone||'—'}</td>
                  <td className="px-4 py-3 text-gray-500">{a.data_nascimento?fmtDate(a.data_nascimento):'—'}</td>
                  <td className="px-4 py-3 text-gray-500">{a.est_name||'—'}</td>
                  <td className="px-4 py-3 text-right"><div className="flex gap-2 justify-end">
                    <Btn variant="secondary" size="sm" onClick={()=>openEdit(a)}>Editar</Btn>
                    <Btn variant="danger" size="sm" onClick={()=>setDelA(a)}>Excluir</Btn>
                  </div></td>
                </tr>)}
              </tbody>
            </table>
            </div>
          </div>
          {totalPages>1&&<div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-400">{filtered.length} alunos{search?' encontrados':''} • Página {page+1} de {totalPages}</p>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}>← Anterior</Btn>
              {Array.from({length:totalPages},(_,i)=>i).filter(i=>Math.abs(i-page)<=2).map(i=><button key={i} onClick={()=>setPage(i)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${i===page?'bg-emerald-600 text-white border-emerald-600':'border-gray-200 text-gray-600 hover:border-emerald-400'}`}>{i+1}</button>)}
              <Btn variant="secondary" size="sm" onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page===totalPages-1}>Próximo →</Btn>
            </div>
          </div>}
        </>}
      </>;
    })()}

    <Modal open={showForm} onClose={()=>setShowForm(false)} title={editA?'Editar Aluno':'Novo Aluno'}>
      <div className="space-y-3">
        <Field label="Nome do Aluno" required><Inp value={f.nome} onChange={e=>upd('nome',e.target.value)} placeholder="Nome completo"/></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPF"><Inp value={f.cpf} onChange={e=>upd('cpf',e.target.value)} placeholder="000.000.000-00"/></Field>
          <Field label="Data de Aniversário"><Inp type="date" value={f.data_nascimento} onChange={e=>upd('data_nascimento',e.target.value)}/></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Inp type="email" value={f.email} onChange={e=>upd('email',e.target.value)} placeholder="aluno@email.com"/></Field>
          <Field label="Telefone"><Inp type="tel" value={f.telefone} onChange={e=>upd('telefone',e.target.value)} placeholder="(11) 99999-9999"/></Field>
        </div>
        <Field label="Estabelecimento"><Sel value={f.est_id} onChange={e=>upd('est_id',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione (opcional)"/></Field>
        {(crmUser?.role==='admin'||crmUser?.role==='manager')&&profs.length>0&&<Field label="Professor responsável"><Sel value={f.professor_id} onChange={e=>upd('professor_id',e.target.value)} options={profs.map(p=>({value:p.id,label:p.nome+(p.est_name?' — '+p.est_name:'')}))} placeholder="Selecione (opcional)"/></Field>}
        {isProfessor&&<div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-700">🎓 Aluno será vinculado ao seu perfil de professor</div>}
        <div className="flex gap-3 pt-1">
          <Btn variant="secondary" className="flex-1" onClick={()=>setShowForm(false)}>Cancelar</Btn>
          <Btn className="flex-1" onClick={save}>Salvar</Btn>
        </div>
      </div>
    </Modal>

    <Modal open={!!delA} onClose={()=>setDelA(null)} title="Excluir Aluno">
      <p className="text-sm text-gray-600 mb-5">Excluir o aluno <strong>{delA?.nome}</strong>?</p>
      <div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setDelA(null)}>Cancelar</Btn><Btn variant="danger" className="flex-1" onClick={del}>Excluir</Btn></div>
    </Modal>
  </div>;
}

function CRMBar({showToast,crmUser}){
  const [ests,setEsts]=useState([]);
  // Auto-seleciona o estabelecimento do usuário impersonado (se tiver apenas um)
  const userEstIds=(crmUser?.est_ids||[]).map(Number).filter(Boolean);
  const defaultEstId=userEstIds.length===1?String(userEstIds[0]):'';
  const [estId,setEstId]=useState(defaultEstId);
  const [alunos,setAlunos]=useState([]);
  const [vendas,setVendas]=useState([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState('novo');

  const load=()=>{
    Promise.all([
      barApi.list(estId?{estId}:{}),
      estApi.list(),
      alunoApi.list(),
      professorApi.list(),
    ])
      .then(([v,e,a,p])=>{
        const filtered=userEstIds.length?e.filter(x=>userEstIds.includes(Number(x.id))):e;
        const profs=(p||[]).filter(x=>x.ativo!==false).map(x=>({...x,id:null,_tipo:'professor'}));
        setVendas(v);setEsts(filtered);
        setAlunos([...a.filter(x=>x.ativo!==false),...profs]);
      })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[estId]);

  const save=async(data)=>{
    try{await barApi.create({...data,est_id:estId||null});showToast('Venda registrada!','success');setTab('historico');load();}
    catch(e){showToast(e.message,'error');throw e;}
  };
  const del=async(id)=>{
    try{await barApi.remove(id);showToast('Excluído','info');load();}
    catch(e){showToast(e.message,'error');}
  };

  return<div>
    <div className="flex items-center justify-between mb-4">
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button onClick={()=>setTab('novo')} className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${tab==='novo'?'bg-white shadow text-emerald-700':'text-gray-500'}`}>+ Nova Venda</button>
        <button onClick={()=>setTab('historico')} className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${tab==='historico'?'bg-white shadow text-emerald-700':'text-gray-500'}`}>Histórico</button>
      </div>
      <select value={estId} onChange={e=>setEstId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
        <option value="">Todos os estabelecimentos</option>
        {ests.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </div>
    {tab==='novo'&&<VendasForm titulo="Registrar Consumo de Bar" labelItem="Bebidas / Itens" onSave={save} alunos={alunos} loading={loading} showFoto={true}/>}
    {tab==='historico'&&(loading?<Spinner/>:<VendasList rows={vendas} onDelete={del} tipo="bar"/>)}
  </div>;
}

// ================================================================
// CRM MANUTENÇÃO
// ================================================================
function CRMManutencao({showToast,crmUser}){
  const [ests,setEsts]=useState([]);
  const userEstIds=(crmUser?.est_ids||[]).map(Number).filter(Boolean);
  const defaultEstId=userEstIds.length===1?String(userEstIds[0]):'';
  const [estId,setEstId]=useState(defaultEstId);
  const [alunos,setAlunos]=useState([]);
  const [vendas,setVendas]=useState([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState('novo');

  const load=()=>{
    Promise.all([
      manutencaoApi.list(estId?{estId}:{}),
      estApi.list(),
      alunoApi.list(),
      professorApi.list(),
    ])
      .then(([v,e,a,p])=>{
        const filtered=userEstIds.length?e.filter(x=>userEstIds.includes(Number(x.id))):e;
        const profs=(p||[]).filter(x=>x.ativo!==false).map(x=>({...x,id:null,_tipo:'professor'}));
        setVendas(v);setEsts(filtered);
        setAlunos([...a.filter(x=>x.ativo!==false),...profs]);
      })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[estId]);

  const save=async(data)=>{
    try{await manutencaoApi.create({...data,est_id:estId||null});showToast('Registro salvo!','success');setTab('historico');load();}
    catch(e){showToast(e.message,'error');throw e;}
  };
  const del=async(id)=>{
    try{await manutencaoApi.remove(id);showToast('Excluído','info');load();}
    catch(e){showToast(e.message,'error');}
  };

  return<div>
    <div className="flex items-center justify-between mb-4">
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        <button onClick={()=>setTab('novo')} className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${tab==='novo'?'bg-white shadow text-emerald-700':'text-gray-500'}`}>+ Novo Registro</button>
        <button onClick={()=>setTab('historico')} className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${tab==='historico'?'bg-white shadow text-emerald-700':'text-gray-500'}`}>Histórico</button>
      </div>
      <select value={estId} onChange={e=>setEstId(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
        <option value="">Todos os estabelecimentos</option>
        {ests.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
    </div>
    {tab==='novo'&&<VendasForm titulo="Registrar Loja & Equipamentos" labelItem="Equipamentos / Serviços" onSave={save} alunos={alunos} loading={loading}/>}
    {tab==='historico'&&(loading?<Spinner/>:<VendasList rows={vendas} onDelete={del} tipo="manutencao"/>)}
  </div>;
}

// CRM PROFESSORS
// ================================================================
function CRMProfessors({crmUser,showToast}){
  const [profs,setProfs]=useState([]);
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showForm,setShowForm]=useState(false);
  const [editP,setEditP]=useState(null);
  const BLANK_P={est_id:'',nome:'',cpf:'',data_nascimento:'',email:'',telefone:'',valor_hora_avulso:'',percentual_repasse:''};
  const [f,setF]=useState(BLANK_P);
  const [delP,setDelP]=useState(null);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));

  const load=()=>{
    Promise.all([professorApi.list(),estApi.list()])
      .then(([p,e])=>{setProfs(p);setEsts(e);})
      .catch(()=>{})
      .finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);

  const openNew=()=>{setF(BLANK_P);setEditP(null);setShowForm(true);};
  const openEdit=(p)=>{
    setF({est_id:p.est_id||'',nome:p.nome||'',cpf:p.cpf||'',data_nascimento:p.data_nascimento?p.data_nascimento.split('T')[0]:'',email:p.email||'',telefone:p.telefone||'',valor_hora_avulso:p.valor_hora_avulso||'',percentual_repasse:p.percentual_repasse||''});
    setEditP(p);setShowForm(true);
  };

  const save=async()=>{
    if(!f.nome){showToast('Nome é obrigatório','error');return;}
    try{
      const payload={...f,est_id:f.est_id||null,data_nascimento:f.data_nascimento||null,valor_hora_avulso:parseFloat(f.valor_hora_avulso)||0,percentual_repasse:parseFloat(f.percentual_repasse)||0};
      if(editP){await professorApi.update(editP.id,payload);}else{await professorApi.create(payload);}
      showToast('Professor salvo!','success');setShowForm(false);load();
    }catch(e){showToast(e.message,'error');}
  };

  const del=async(id)=>{
    try{await professorApi.remove(id);showToast('Professor excluído','info');setDelP(null);load();}
    catch(e){showToast(e.message,'error');}
  };

  if(loading)return<Spinner/>;

  return<div className="p-6 max-w-5xl">
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-black text-gray-900">Professores</h1>
      <Btn onClick={openNew}>+ Novo Professor</Btn>
    </div>

    {profs.length===0
      ?<div className="text-center py-20 text-gray-400"><p className="text-5xl mb-3">🎓</p><p className="text-lg">Nenhum professor cadastrado</p><Btn className="mt-5" onClick={openNew}>+ Cadastrar primeiro professor</Btn></div>
      :<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Nome','CPF','Telefone','Email','Valor/h Avulso','Estabelecimento','Ações'].map(h=><th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h==='Ações'?'text-right':''}`}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {profs.map(p=><tr key={p.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-semibold text-gray-800">{p.nome}</td>
              <td className="px-4 py-3 text-gray-500">{p.cpf||'—'}</td>
              <td className="px-4 py-3 text-gray-500">{p.telefone||'—'}</td>
              <td className="px-4 py-3 text-gray-500">{p.email||'—'}</td>
              <td className="px-4 py-3 text-gray-700 font-medium">{p.valor_hora_avulso?fmt$(p.valor_hora_avulso)+'/h':'—'}</td>
              <td className="px-4 py-3 text-gray-500">{p.est_name||'—'}</td>
              <td className="px-4 py-3 text-right"><div className="flex gap-2 justify-end"><Btn variant="secondary" size="sm" onClick={()=>openEdit(p)}>Editar</Btn><Btn variant="danger" size="sm" onClick={()=>setDelP(p)}>Excluir</Btn></div></td>
            </tr>)}
          </tbody>
        </table>
        </div>
      </div>
    }

    <Modal open={showForm} onClose={()=>setShowForm(false)} title={editP?'Editar Professor':'Novo Professor'}>
      <div className="space-y-3">
        <Field label="Estabelecimento"><Sel value={f.est_id} onChange={e=>upd('est_id',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione (opcional)"/></Field>
        <Field label="Nome do Professor" required><Inp value={f.nome} onChange={e=>upd('nome',e.target.value)} placeholder="Nome completo"/></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPF"><Inp value={f.cpf} onChange={e=>upd('cpf',e.target.value)} placeholder="000.000.000-00"/></Field>
          <Field label="Data de Nascimento"><Inp type="date" value={f.data_nascimento} onChange={e=>upd('data_nascimento',e.target.value)}/></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><Inp type="email" value={f.email} onChange={e=>upd('email',e.target.value)} placeholder="prof@email.com"/></Field>
          <Field label="Telefone"><Inp value={f.telefone} onChange={e=>upd('telefone',e.target.value)} placeholder="(00) 00000-0000"/></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor por hora (aula avulsa)" help="Referência p/ planos avulsos"><Inp type="number" value={f.valor_hora_avulso} onChange={e=>upd('valor_hora_avulso',e.target.value)} placeholder="Ex: 80.00"/></Field>
          <Field label="% de repasse" help="% do valor do plano pago ao professor"><Inp type="number" value={f.percentual_repasse} onChange={e=>upd('percentual_repasse',e.target.value)} placeholder="Ex: 70"/></Field>
        </div>
        <div className="flex gap-3 pt-1">
          <Btn variant="secondary" className="flex-1" onClick={()=>setShowForm(false)}>Cancelar</Btn>
          <Btn className="flex-1" onClick={save}>Salvar</Btn>
        </div>
      </div>
    </Modal>

    <Modal open={!!delP} onClose={()=>setDelP(null)} title="Excluir Professor">
      <p className="text-sm text-gray-600 mb-5">Excluir o professor <strong>{delP?.nome}</strong>?</p>
      <div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setDelP(null)}>Cancelar</Btn><Btn variant="danger" className="flex-1" onClick={()=>del(delP.id)}>Excluir</Btn></div>
    </Modal>
  </div>;
}

function CRMUnimidia({crmUser,showToast}){
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{estApi.list().then(setEsts).catch(()=>{}).finally(()=>setLoading(false));},[]);
  const optin=ests.filter(e=>e.unimidia_divulgacao);
  const req=(titulo)=>{showToast(`Solicitação enviada para: ${titulo}`,'success');};
  if(loading)return<Spinner/>;
  return<div className="p-6 max-w-5xl">
    {/* Header */}
    <div className="bg-gradient-to-r from-blue-700 to-blue-500 rounded-2xl p-6 mb-6 text-white flex items-center gap-5">
      <div className="text-5xl">📺</div>
      <div><h1 className="text-2xl font-black mb-1">Divulgue seus Espaços via Unimídia</h1>
      <p className="text-blue-100 text-sm">Alcance milhares de apaixonados por esportes através da rede de mídia Unimídia. Selecione o espaço ideal e solicite uma proposta.</p></div>
    </div>

    {/* Status opt-in */}
    {optin.length>0&&<div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-6">
      <p className="text-sm font-semibold text-emerald-800 mb-2">✅ Seus estabelecimentos cadastrados para divulgação via Unimídia:</p>
      <div className="flex flex-wrap gap-2">{optin.map(e=><span key={e.id} className="bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1 rounded-full">{e.name}</span>)}</div>
    </div>}
    {optin.length===0&&<div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 text-sm text-amber-800">
      ⚠️ Nenhum estabelecimento seu optou pela divulgação via Unimídia. Habilite em <strong>Estabelecimentos → Cadastro → Divulgação via Unimídia: Sim</strong>.
    </div>}

    {/* Aviso API */}
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-6 flex items-start gap-2.5">
      <span className="text-blue-500 text-lg shrink-0">🔗</span>
      <p className="text-xs text-blue-700">Os espaços abaixo são demonstrativos. A integração com a API Unimídia está em desenvolvimento — em breve os dados serão atualizados em tempo real.</p>
    </div>

    {/* Grade de espaços */}
    <h2 className="text-lg font-black text-gray-800 mb-4">Espaços Disponíveis para Divulgação</h2>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {UNIMIDIA_MOCK.map(m=><div key={m.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-gray-800 leading-tight">{m.titulo}</h3>
          <span className="shrink-0 bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{m.tipo}</span>
        </div>
        <div className="text-xs text-gray-500 space-y-1">
          <p>📍 <span className="font-medium text-gray-700">{m.locais}</span></p>
          <p>👥 {m.publico}</p>
          <p>📈 Alcance: <span className="font-semibold text-emerald-600">{m.alcance}</span></p>
          <p>💰 Investimento: <span className="font-semibold text-gray-800">{m.preco}</span></p>
        </div>
        <Btn onClick={()=>req(m.titulo)} className="w-full mt-auto">Solicitar Proposta</Btn>
      </div>)}
    </div>

    <p className="text-xs text-gray-400 text-center mt-8">Unimídia © 2025 — Parceria exclusiva P. Soluções para Esportes &amp; Reservas</p>
  </div>;
}

// ================================================================
// CRM PROFISSIONAIS EF (Admin)
// ================================================================
const BLANK_PEF={nome:'',cref:'',especialidade:'',bio:'',foto:'',foto_x:50,foto_y:30,phone:'',email:'',site:'',street:'',number:'',complement:'',cep:'',city:'',state:'',valor_hora:'',aceita_avulso:true,aceita_mensal:false,marketplace_visible:false,operating_hours:{...DEFAULT_HOURS},login_email:'',login_password:'',login_password2:''};

function CRMProfissionaisEF({showToast}){
  const [list,setList]=useState([]);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState('lista');
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState(BLANK_PEF);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [cepLoading,setCepLoading]=useState(false);

  const load=()=>{setLoading(true);profEfApi.list().then(setList).catch(()=>{}).finally(()=>setLoading(false));};
  useEffect(()=>{load();},[]);

  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));

  const openNew=()=>{setEditId(null);setForm(BLANK_PEF);setTab('form');};
  const openEdit=(p)=>{setEditId(p.id);setForm({...BLANK_PEF,...p,valor_hora:p.valor_hora||'',login_email:'',login_password:'',operating_hours:p.operating_hours||{...DEFAULT_HOURS}});setTab('form');};

  const handleCEP=async(v)=>{upd('cep',v);if(v.replace(/\D/g,'').length===8){setCepLoading(true);const d=await viaCEP(v);setCepLoading(false);if(d){upd('street',d.logradouro);upd('city',d.localidade);upd('state',d.uf);}}};

  const handleFoto=async(e)=>{
    const file=e.target.files[0];if(!file)return;
    if(file.size>20*1024*1024){showToast('Máx. 20MB','error');return;}
    setUploading(true);const dataUrl=await compressImage(file);if(dataUrl)upd('foto',dataUrl);setUploading(false);
  };

  const save=async()=>{
    if(!form.nome){showToast('Nome é obrigatório','error');return;}
    setSaving(true);
    try{
      const payload={...form,valor_hora:Number(form.valor_hora)||0};
      if(editId){await profEfApi.update(editId,payload);showToast('Profissional atualizado!');}
      else{
        if(!form.login_email||!form.login_password){showToast('Email e senha de login são obrigatórios','error');setSaving(false);return;}
        if(form.login_password.length<6){showToast('A senha deve ter no mínimo 6 caracteres','error');setSaving(false);return;}
        if(form.login_password!==form.login_password2){showToast('As senhas não coincidem','error');setSaving(false);return;}
        await profEfApi.create(payload);showToast('Profissional cadastrado com login criado!');
      }
      load();setTab('lista');
    }catch(e){showToast(e.message||'Erro ao salvar','error');}
    finally{setSaving(false);}
  };

  const remove=async(id)=>{
    if(!confirm('Excluir profissional?'))return;
    try{await profEfApi.remove(id);showToast('Excluído');load();}catch(e){showToast(e.message||'Erro','error');}
  };

  if(loading)return<Spinner/>;
  return<div className="p-6 max-w-5xl">
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-black text-gray-900">🏋️ Profissionais de Ed. Física</h1>
      <Btn onClick={openNew}>+ Novo Profissional</Btn>
    </div>
    <Tabs tabs={[{key:'lista',label:`Lista (${list.length})`},{key:'form',label:editId?'Editar':'Novo'}]} active={tab} onChange={setTab}/>
    {tab==='lista'&&<div className="mt-4 space-y-3">
      {list.length===0&&<div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">🏋️</p><p>Nenhum profissional cadastrado</p></div>}
      {list.map(p=><div key={p.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4 shadow-sm">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-indigo-100 shrink-0 flex items-center justify-center">{p.foto?<img src={p.foto} alt={p.nome} className="w-full h-full object-cover"/>:<span className="text-2xl">🏋️</span>}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-gray-800">{p.nome}</span>{p.cref&&<span className="text-xs text-gray-400">CREF {p.cref}</span>}{p.marketplace_visible&&<Badge color="blue">Marketplace</Badge>}</div>
          <p className="text-sm text-gray-500 truncate">{p.especialidade||'—'} • {p.city||'—'}{p.state?`/${p.state}`:''}</p>
          <p className="text-xs text-gray-400">{p.phone} • {p.email}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Btn variant="secondary" size="sm" onClick={()=>openEdit(p)}>Editar</Btn>
          <Btn variant="danger" size="sm" onClick={()=>remove(p.id)}>Excluir</Btn>
        </div>
      </div>)}
    </div>}
    {tab==='form'&&<div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-5">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          <h2 className="font-bold text-gray-700">Dados Pessoais</h2>
          <Field label="Nome completo" required><Inp value={form.nome} onChange={e=>upd('nome',e.target.value)}/></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CREF"><Inp value={form.cref} onChange={e=>upd('cref',e.target.value)} placeholder="000000-G/SP"/></Field>
            <Field label="Especialidade"><Inp value={form.especialidade} onChange={e=>upd('especialidade',e.target.value)} placeholder="Musculação, Funcional..."/></Field>
          </div>
          <Field label="Bio / Apresentação"><textarea value={form.bio} onChange={e=>upd('bio',e.target.value)} rows={3} placeholder="Apresentação profissional..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"/></Field>
          <Field label="Telefone"><Inp value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="(00) 00000-0000"/></Field>
          <Field label="Email"><Inp type="email" value={form.email} onChange={e=>upd('email',e.target.value)}/></Field>
          <Field label="Site"><Inp type="url" value={form.site} onChange={e=>upd('site',e.target.value)} placeholder="https://..."/></Field>
          <Field label="Valor/hora (R$)"><Inp type="number" value={form.valor_hora} onChange={e=>upd('valor_hora',e.target.value)} min="0" step="0.01"/></Field>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.aceita_avulso} onChange={e=>upd('aceita_avulso',e.target.checked)} className="rounded"/><span>Avulso</span></label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.aceita_mensal} onChange={e=>upd('aceita_mensal',e.target.checked)} className="rounded"/><span>Plano mensal</span></label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.marketplace_visible} onChange={e=>upd('marketplace_visible',e.target.checked)} className="rounded"/><span className="text-indigo-600 font-medium">Exibir no marketplace</span></label>
          </div>
        </div>
        {!editId&&<div className="bg-white rounded-2xl border border-indigo-100 p-5 space-y-3">
          <h2 className="font-bold text-gray-700">🔑 Login do Profissional</h2>
          <p className="text-xs text-gray-400">Credenciais de acesso ao CRM</p>
          <Field label="Email de login" required><Inp type="email" value={form.login_email} onChange={e=>upd('login_email',e.target.value)}/></Field>
          <Field label="Senha" required><Inp type="password" value={form.login_password} onChange={e=>upd('login_password',e.target.value)} placeholder="Mínimo 6 caracteres"/></Field>
          <Field label="Confirmar senha" required>
            <Inp type="password" value={form.login_password2||''} onChange={e=>upd('login_password2',e.target.value)} placeholder="Repita a senha"/>
            {form.login_password2&&form.login_password!==form.login_password2&&<p className="text-xs text-red-500 mt-1">⚠️ As senhas não coincidem</p>}
            {form.login_password2&&form.login_password===form.login_password2&&<p className="text-xs text-emerald-600 mt-1">✅ Senhas conferem</p>}
          </Field>
        </div>}
      </div>
      <div className="space-y-5">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          <h2 className="font-bold text-gray-700">Foto de Perfil</h2>
          <label className={`flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors ${uploading?'border-indigo-300 bg-indigo-50':'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'}`}>
            <input type="file" accept="image/*" className="hidden" onChange={handleFoto} disabled={uploading}/>
            <span className="text-3xl">{uploading?'⏳':'📷'}</span>
            <p className="text-sm font-medium text-gray-700">{uploading?'Processando...':'Clique para selecionar foto'}</p>
          </label>
          {form.foto&&<div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden h-48"><img src={form.foto} alt="foto" className="w-full h-full object-cover" style={{objectPosition:`${form.foto_x??50}% ${form.foto_y??30}%`}}/><button onClick={()=>upd('foto','')} className="absolute top-2 right-2 bg-red-600/90 text-white text-xs rounded-lg px-2 py-1">✕ Remover</button><div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">Prévia do enquadramento</div></div>
            <div className="space-y-2 px-1">
              <div className="flex items-center gap-3"><span className="text-xs text-gray-500 w-20 shrink-0">← Horizontal →</span><input type="range" min="0" max="100" value={form.foto_x??50} onChange={e=>upd('foto_x',Number(e.target.value))} className="flex-1 accent-indigo-600"/><span className="text-xs text-gray-400 w-6">{form.foto_x??50}%</span></div>
              <div className="flex items-center gap-3"><span className="text-xs text-gray-500 w-20 shrink-0">↑ Vertical ↓</span><input type="range" min="0" max="100" value={form.foto_y??30} onChange={e=>upd('foto_y',Number(e.target.value))} className="flex-1 accent-indigo-600"/><span className="text-xs text-gray-400 w-6">{form.foto_y??30}%</span></div>
            </div>
          </div>}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          <h2 className="font-bold text-gray-700">Localização</h2>
          <Field label="CEP" help={cepLoading?'Buscando...':''}><Inp value={form.cep} onChange={e=>handleCEP(e.target.value)} placeholder="00000-000"/></Field>
          <Field label="Rua"><Inp value={form.street} onChange={e=>upd('street',e.target.value)}/></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Número"><Inp value={form.number} onChange={e=>upd('number',e.target.value)}/></Field><Field label="Complemento"><Inp value={form.complement} onChange={e=>upd('complement',e.target.value)}/></Field></div>
          <div className="grid grid-cols-3 gap-3"><div className="col-span-2"><Field label="Cidade"><Inp value={form.city} onChange={e=>upd('city',e.target.value)}/></Field></div><Field label="UF"><Inp value={form.state} onChange={e=>upd('state',e.target.value.toUpperCase().slice(0,2))} placeholder="SP"/></Field></div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h2 className="font-bold text-gray-700 mb-3">Disponibilidade</h2>
          <HoursEditor value={form.operating_hours} onChange={v=>upd('operating_hours',v)}/>
        </div>
      </div>
      <div className="lg:col-span-2 flex gap-3">
        <Btn onClick={save} disabled={saving} className="flex-1">{saving?'Salvando...':'💾 Salvar'}</Btn>
        <Btn variant="secondary" onClick={()=>{setTab('lista');setEditId(null);setForm(BLANK_PEF);}}>Cancelar</Btn>
      </div>
    </div>}
  </div>;
}

// ================================================================
// CRM PROFISSIONAL — visão do próprio profissional logado
// ================================================================
function CRMProfissionalHome({crmUser,showToast}){
  const [form,setForm]=useState(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));

  useEffect(()=>{
    if(!crmUser.profissional_id)return;
    profEfApi.publicGet(crmUser.profissional_id)
      .then(p=>setForm({...p,valor_hora:p.valor_hora||'',operating_hours:p.operating_hours||{...DEFAULT_HOURS}}))
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[crmUser.profissional_id]);

  const handleFoto=async(e)=>{
    const file=e.target.files[0];if(!file)return;
    setUploading(true);const dataUrl=await compressImage(file);if(dataUrl)upd('foto',dataUrl);setUploading(false);
  };

  const save=async()=>{
    setSaving(true);
    try{await profEfApi.update(crmUser.profissional_id,{...form,valor_hora:Number(form.valor_hora)||0});showToast('Perfil atualizado!');}
    catch(e){showToast(e.message||'Erro ao salvar','error');}
    finally{setSaving(false);}
  };

  if(loading||!form)return<Spinner/>;
  return<div className="p-6 max-w-3xl">
    <h1 className="text-2xl font-black text-gray-900 mb-6">👤 Meu Perfil</h1>
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <h2 className="font-bold text-gray-700">Informações Profissionais</h2>
        <Field label="Nome"><Inp value={form.nome||''} onChange={e=>upd('nome',e.target.value)}/></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CREF"><Inp value={form.cref||''} onChange={e=>upd('cref',e.target.value)}/></Field>
          <Field label="Especialidade"><Inp value={form.especialidade||''} onChange={e=>upd('especialidade',e.target.value)}/></Field>
        </div>
        <Field label="Bio / Apresentação"><textarea value={form.bio||''} onChange={e=>upd('bio',e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"/></Field>
        <Field label="Telefone"><Inp value={form.phone||''} onChange={e=>upd('phone',e.target.value)}/></Field>
        <Field label="Email de contato"><Inp type="email" value={form.email||''} onChange={e=>upd('email',e.target.value)}/></Field>
        <Field label="Site"><Inp type="url" value={form.site||''} onChange={e=>upd('site',e.target.value)}/></Field>
        <Field label="Valor/hora (R$)"><Inp type="number" value={form.valor_hora||''} onChange={e=>upd('valor_hora',e.target.value)} min="0" step="0.01"/></Field>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={!!form.aceita_avulso} onChange={e=>upd('aceita_avulso',e.target.checked)} className="rounded"/><span>Aulas avulsas</span></label>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={!!form.aceita_mensal} onChange={e=>upd('aceita_mensal',e.target.checked)} className="rounded"/><span>Planos mensais</span></label>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={!!form.marketplace_visible} onChange={e=>upd('marketplace_visible',e.target.checked)} className="rounded"/><span className="text-indigo-600 font-medium">Visível no marketplace</span></label>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <h2 className="font-bold text-gray-700">Foto de Perfil</h2>
        {form.foto&&<div className="relative rounded-xl overflow-hidden h-40 mb-2"><img src={form.foto} alt="foto" className="w-full h-full object-cover object-top"/><button onClick={()=>upd('foto','')} className="absolute top-2 right-2 bg-red-600/90 text-white text-xs rounded-lg px-2 py-1">✕</button></div>}
        <label className="flex items-center gap-2 cursor-pointer text-sm text-indigo-600 hover:underline font-medium">
          <input type="file" accept="image/*" className="hidden" onChange={handleFoto} disabled={uploading}/>
          {uploading?'⏳ Processando...':'📷 Alterar foto'}
        </label>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h2 className="font-bold text-gray-700 mb-3">Minha Disponibilidade</h2>
        <HoursEditor value={form.operating_hours} onChange={v=>upd('operating_hours',v)}/>
      </div>
      <Btn onClick={save} disabled={saving} className="w-full">{saving?'Salvando...':'💾 Salvar Perfil'}</Btn>
    </div>
  </div>;
}

// ================================================================
// MAIN APP
// ================================================================
// ================================================================
// CRM FUNCIONÁRIOS — RH (CLT/PJ), ponto e folha
// ================================================================
const PONTO_TIPOS=[
  {value:'normal',label:'Normal'},{value:'falta',label:'Falta'},{value:'atestado',label:'Atestado'},
  {value:'folga',label:'Folga'},{value:'ferias',label:'Férias'},
];
function CRMFuncionarios({crmUser,showToast}){
  const [tab,setTab]=useState('lista');
  const [ests,setEsts]=useState([]);
  const [emps,setEmps]=useState([]);
  const [folha,setFolha]=useState(null);
  const [form,setForm]=useState(null);
  const isAdmin=crmUser.role==='admin';
  const canEdit=isAdmin||crmUser.role==='manager';

  // ponto
  const mr=monthRange();
  const [pFrom,setPFrom]=useState(mr.from);
  const [pTo,setPTo]=useState(mr.to);
  const [selEmp,setSelEmp]=useState('');
  const [pontos,setPontos]=useState([]);
  const [pForm,setPForm]=useState(null);

  useEffect(()=>{estApi.list().then(setEsts).catch(()=>{});},[]);
  const loadEmps =useCallback(()=>{employeeApi.list().then(setEmps).catch(()=>{});},[]);
  const loadFolha=useCallback(()=>{employeeApi.folha().then(setFolha).catch(()=>{});},[]);
  const loadPonto=useCallback(()=>{if(selEmp)pontoApi.list({employeeId:selEmp,from:pFrom,to:pTo}).then(setPontos).catch(()=>{});else setPontos([]);},[selEmp,pFrom,pTo]);
  useEffect(()=>{loadEmps();},[loadEmps]);
  useEffect(()=>{if(tab==='folha')loadFolha();},[tab,loadFolha]);
  useEffect(()=>{if(tab==='ponto')loadPonto();},[tab,loadPonto]);

  const BLANK={est_id:'',tipo:'clt',nome:'',cargo:'',cpf_cnpj:'',email:'',telefone:'',salario_base:'',encargos:'',beneficios:'',vale_transporte:'',dia_pagamento:5,data_admissao:'',ativo:true};
  const saveEmp=async()=>{
    if(!form.nome){showToast&&showToast('Nome obrigatório','error');return;}
    try{
      const body={...form,
        salario_base:parseFloat(form.salario_base)||0,encargos:parseFloat(form.encargos)||0,
        beneficios:parseFloat(form.beneficios)||0,vale_transporte:parseFloat(form.vale_transporte)||0,
        dia_pagamento:parseInt(form.dia_pagamento)||5,est_id:form.est_id||null,data_admissao:form.data_admissao||null};
      if(form.id)await employeeApi.update(form.id,body);else await employeeApi.create(body);
      setForm(null);loadEmps();showToast&&showToast('Funcionário salvo','success');
    }catch(e){showToast&&showToast(e.message||'Erro','error');}
  };
  const delEmp=async(id)=>{if(!confirm('Excluir funcionário?'))return;await employeeApi.remove(id);loadEmps();};

  const savePonto=async()=>{
    try{await pontoApi.save({...pForm,employee_id:selEmp});setPForm(null);loadPonto();showToast&&showToast('Ponto registrado','success');}
    catch(e){showToast&&showToast(e.message||'Erro','error');}
  };
  const delPonto=async(id)=>{await pontoApi.remove(id);loadPonto();};

  const custo=(e)=>Number(e.salario_base||0)+Number(e.encargos||0)+Number(e.beneficios||0)+Number(e.vale_transporte||0);
  const totFolha=emps.filter(e=>e.ativo).reduce((s,e)=>s+custo(e),0);

  return<div className="p-6">
    <div className="flex items-center justify-between mb-6">
      <div><h1 className="text-2xl font-black text-gray-900">Funcionários</h1>
      <p className="text-sm text-gray-400">Equipe CLT, prestadores PJ, ponto e folha</p></div>
      {tab==='lista'&&<Btn onClick={()=>setForm({...BLANK})}>+ Novo Funcionário</Btn>}
    </div>

    <div className="border-b border-gray-200 mb-5"><nav className="flex gap-1">
      {[{k:'lista',l:'Equipe'},{k:'ponto',l:'Ponto'},{k:'folha',l:'Folha / Custo'}].map(t=>
        <button key={t.k} onClick={()=>setTab(t.k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${tab===t.k?'border-emerald-600 text-emerald-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.l}</button>)}
    </nav></div>

    {tab==='lista'&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="border-b border-gray-100 bg-gray-50">{['Nome','Cargo','Tipo','Salário/Valor','Encargos','Benefícios','Custo Mensal','Status',''].map((h,i)=><th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-50">
        {emps.length===0&&<tr><td colSpan={9} className="text-center py-10 text-gray-400">Nenhum funcionário cadastrado</td></tr>}
        {emps.map(e=><tr key={e.id} className="hover:bg-gray-50">
          <td className="px-3 py-2.5 font-medium text-gray-800">{e.nome}</td>
          <td className="px-3 py-2.5 text-gray-600">{e.cargo||'—'}</td>
          <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded ${e.tipo==='pj'?'text-indigo-700 bg-indigo-50':'text-emerald-700 bg-emerald-50'}`}>{e.tipo.toUpperCase()}</span></td>
          <td className="px-3 py-2.5 text-gray-600">{fmt$(e.salario_base)}</td>
          <td className="px-3 py-2.5 text-gray-600">{fmt$(e.encargos)}</td>
          <td className="px-3 py-2.5 text-gray-600">{fmt$(e.beneficios)}</td>
          <td className="px-3 py-2.5 font-semibold text-gray-800">{fmt$(custo(e))}</td>
          <td className="px-3 py-2.5">{e.ativo?<span className="text-xs text-emerald-700">Ativo</span>:<span className="text-xs text-gray-400">Inativo</span>}</td>
          <td className="px-3 py-2.5 text-right whitespace-nowrap"><button onClick={()=>setForm({...e,data_admissao:e.data_admissao?.slice(0,10)||''})} className="text-gray-400 hover:text-emerald-600 mr-2">✏️</button>{canEdit&&<button onClick={()=>delEmp(e.id)} className="text-gray-400 hover:text-red-600">🗑️</button>}</td>
        </tr>)}
      </tbody>
      <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50"><td colSpan={6} className="px-3 py-2 text-xs font-bold text-gray-500 uppercase">Custo mensal total (ativos)</td><td className="px-3 py-2 font-bold text-emerald-700">{fmt$(totFolha)}</td><td colSpan={2}/></tr></tfoot>
    </table></div></div>}

    {tab==='ponto'&&<div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div className="w-56"><p className="text-xs text-gray-400 mb-1 font-medium">Funcionário</p>
          <Sel value={selEmp} onChange={e=>setSelEmp(e.target.value)} options={emps.map(e=>({value:String(e.id),label:e.nome}))} placeholder="Selecione..."/></div>
        <div className="w-40"><p className="text-xs text-gray-400 mb-1 font-medium">De</p><Inp type="date" value={pFrom} onChange={e=>setPFrom(e.target.value)}/></div>
        <div className="w-40"><p className="text-xs text-gray-400 mb-1 font-medium">Até</p><Inp type="date" value={pTo} onChange={e=>setPTo(e.target.value)}/></div>
        {selEmp&&<Btn size="sm" onClick={()=>setPForm({data:mr.to,entrada:'',saida:'',tipo:'normal',observacoes:''})}>+ Lançar Ponto</Btn>}
      </div>
      {!selEmp?<div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">🕐</p><p>Selecione um funcionário para ver o ponto</p></div>:
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 bg-gray-50">{['Data','Entrada','Saída','Horas','Tipo','Obs',''].map((h,i)=><th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">
          {pontos.length===0&&<tr><td colSpan={7} className="text-center py-10 text-gray-400">Nenhum registro no período</td></tr>}
          {pontos.map(p=><tr key={p.id} className="hover:bg-gray-50">
            <td className="px-3 py-2.5 text-gray-700">{new Date(p.data).toLocaleDateString('pt-BR')}</td>
            <td className="px-3 py-2.5 text-gray-600">{p.entrada||'—'}</td>
            <td className="px-3 py-2.5 text-gray-600">{p.saida||'—'}</td>
            <td className="px-3 py-2.5 text-gray-600">{Number(p.horas).toFixed(2)}h</td>
            <td className="px-3 py-2.5"><span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{p.tipo}</span></td>
            <td className="px-3 py-2.5 text-gray-400 text-xs">{p.observacoes||'—'}</td>
            <td className="px-3 py-2.5 text-right"><button onClick={()=>delPonto(p.id)} className="text-gray-400 hover:text-red-600">🗑️</button></td>
          </tr>)}
        </tbody>
        <tfoot><tr className="border-t-2 border-gray-200 bg-gray-50"><td colSpan={3} className="px-3 py-2 text-xs font-bold text-gray-500 uppercase">Total de horas</td><td className="px-3 py-2 font-bold text-gray-800">{pontos.reduce((s,p)=>s+Number(p.horas),0).toFixed(2)}h</td><td colSpan={3}/></tr></tfoot>
      </table></div></div>}
    </div>}

    {tab==='folha'&&(folha?<div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-2xl border border-gray-100 p-5"><p className="text-xs text-gray-400 mb-1">Custo mensal total</p><p className="text-2xl font-black text-emerald-700">{fmt$(folha.total_mensal)}</p></div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 bg-gray-50">{['Tipo','Qtd','Salários','Encargos','Benefícios','Vale Transp.','Total'].map((h,i)=><th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">
          {folha.por_tipo.length===0&&<tr><td colSpan={7} className="text-center py-10 text-gray-400">Sem funcionários ativos</td></tr>}
          {folha.por_tipo.map(r=><tr key={r.tipo} className="hover:bg-gray-50">
            <td className="px-3 py-2.5 font-medium text-gray-800">{r.tipo.toUpperCase()}</td>
            <td className="px-3 py-2.5 text-gray-600">{r.qtd}</td>
            <td className="px-3 py-2.5 text-gray-600">{fmt$(r.salarios)}</td>
            <td className="px-3 py-2.5 text-gray-600">{fmt$(r.encargos)}</td>
            <td className="px-3 py-2.5 text-gray-600">{fmt$(r.beneficios)}</td>
            <td className="px-3 py-2.5 text-gray-600">{fmt$(r.vale_transporte)}</td>
            <td className="px-3 py-2.5 font-semibold text-gray-800">{fmt$(r.total)}</td>
          </tr>)}
        </tbody>
      </table></div></div>
    </div>:<div className="text-center py-10 text-gray-400">Carregando...</div>)}

    {/* Modal funcionário */}
    <Modal open={!!form} onClose={()=>setForm(null)} title={form?.id?'Editar Funcionário':'Novo Funcionário'} maxW="max-w-xl">
      {form&&<div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo" required><Sel value={form.tipo} onChange={e=>setForm(p=>({...p,tipo:e.target.value}))} options={[{value:'clt',label:'CLT (funcionário)'},{value:'pj',label:'PJ (prestador)'}]}/></Field>
          <Field label="Estabelecimento"><Sel value={form.est_id} onChange={e=>setForm(p=>({...p,est_id:e.target.value}))} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Geral / nenhum"/></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome" required><Inp value={form.nome} onChange={e=>setForm(p=>({...p,nome:e.target.value}))}/></Field>
          <Field label="Cargo"><Inp value={form.cargo} onChange={e=>setForm(p=>({...p,cargo:e.target.value}))} placeholder="Recepcionista, Faxineira..."/></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={form.tipo==='pj'?'CNPJ':'CPF'}><Inp value={form.cpf_cnpj} onChange={e=>setForm(p=>({...p,cpf_cnpj:e.target.value}))}/></Field>
          <Field label="Telefone"><Inp value={form.telefone} onChange={e=>setForm(p=>({...p,telefone:e.target.value}))}/></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={form.tipo==='pj'?'Valor mensal (R$)':'Salário base (R$)'} required><Inp type="number" value={form.salario_base} onChange={e=>setForm(p=>({...p,salario_base:e.target.value}))}/></Field>
          <Field label="Dia de pagamento"><Inp type="number" value={form.dia_pagamento} onChange={e=>setForm(p=>({...p,dia_pagamento:e.target.value}))}/></Field>
        </div>
        {form.tipo!=='pj'&&<div className="grid grid-cols-3 gap-3">
          <Field label="Encargos (R$)" help="INSS/FGTS/13/férias"><Inp type="number" value={form.encargos} onChange={e=>setForm(p=>({...p,encargos:e.target.value}))}/></Field>
          <Field label="Benefícios (R$)" help="VR/VA/plano"><Inp type="number" value={form.beneficios} onChange={e=>setForm(p=>({...p,beneficios:e.target.value}))}/></Field>
          <Field label="Vale Transp. (R$)"><Inp type="number" value={form.vale_transporte} onChange={e=>setForm(p=>({...p,vale_transporte:e.target.value}))}/></Field>
        </div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Admissão"><Inp type="date" value={form.data_admissao} onChange={e=>setForm(p=>({...p,data_admissao:e.target.value}))}/></Field>
          <Field label="Status"><Sel value={form.ativo?'sim':'nao'} onChange={e=>setForm(p=>({...p,ativo:e.target.value==='sim'}))} options={[{value:'sim',label:'Ativo'},{value:'nao',label:'Inativo'}]}/></Field>
        </div>
        <div className="flex gap-3 pt-2"><Btn variant="secondary" className="flex-1" onClick={()=>setForm(null)}>Cancelar</Btn><Btn className="flex-1" onClick={saveEmp}>Salvar</Btn></div>
      </div>}
    </Modal>

    {/* Modal ponto */}
    <Modal open={!!pForm} onClose={()=>setPForm(null)} title="Lançar Ponto">
      {pForm&&<div className="space-y-3">
        <Field label="Data" required><Inp type="date" value={pForm.data} onChange={e=>setPForm(p=>({...p,data:e.target.value}))}/></Field>
        <Field label="Tipo"><Sel value={pForm.tipo} onChange={e=>setPForm(p=>({...p,tipo:e.target.value}))} options={PONTO_TIPOS}/></Field>
        {pForm.tipo==='normal'&&<div className="grid grid-cols-2 gap-3">
          <Field label="Entrada"><Inp type="time" value={pForm.entrada} onChange={e=>setPForm(p=>({...p,entrada:e.target.value}))}/></Field>
          <Field label="Saída"><Inp type="time" value={pForm.saida} onChange={e=>setPForm(p=>({...p,saida:e.target.value}))}/></Field>
        </div>}
        <Field label="Observações"><Inp value={pForm.observacoes} onChange={e=>setPForm(p=>({...p,observacoes:e.target.value}))}/></Field>
        <div className="flex gap-3 pt-2"><Btn variant="secondary" className="flex-1" onClick={()=>setPForm(null)}>Cancelar</Btn><Btn className="flex-1" onClick={savePonto}>Salvar</Btn></div>
      </div>}
    </Modal>
  </div>;
}

// ================================================================
// CRM FINANCEIRO — fluxo de caixa, despesas, repasse e relatórios
// ================================================================
const EXP_CATS=[
  {value:'aluguel',label:'Aluguel'},{value:'luz',label:'Energia'},{value:'agua',label:'Água'},
  {value:'gas',label:'Gás'},
  {value:'internet',label:'Internet/Telefone'},{value:'manutencao',label:'Manutenção'},
  {value:'salarios',label:'Salários'},{value:'marketing',label:'Marketing'},
  {value:'impostos',label:'Impostos'},{value:'material',label:'Material'},{value:'outro',label:'Outro'},
];
const EXP_CAT_LABEL=Object.fromEntries(EXP_CATS.map(c=>[c.value,c.label]));
function monthRange(){
  const n=new Date();const from=new Date(n.getFullYear(),n.getMonth(),1);const to=new Date(n.getFullYear(),n.getMonth()+1,0);
  const f=d=>d.toISOString().split('T')[0];return{from:f(from),to:f(to)};
}
const PGTO_STATUS_OPTS=[{value:'pendente',label:'Pendente'},{value:'pago',label:'Pago'},{value:'em_atraso',label:'Em Atraso'}];
const PGTO_FORMA_OPTS=[{value:'pix',label:'💠 Pix'},{value:'debito',label:'🏦 Débito'},{value:'credito',label:'💳 Crédito'},{value:'dinheiro',label:'💵 Dinheiro'},{value:'boleto',label:'📄 Boleto'}];
const PGTO_STATUS_BADGE={pendente:'bg-amber-100 text-amber-700',pago:'bg-emerald-100 text-emerald-700',em_atraso:'bg-red-100 text-red-700'};
const TIPO_LABEL={reserva:'📅 Reserva',aula:'📚 Aula/Plano',bar:'🍺 Bar',manutencao:'🛒 Loja & Equip.'};

function CRMFinanceiro({crmUser,showToast}){
  const [tab,setTab]=useState('fluxo');
  const mr=monthRange();
  const [from,setFrom]=useState(mr.from);
  const [to,setTo]=useState(mr.to);
  const isAdmin=crmUser.role==='admin';

  // fluxo
  const [cf,setCf]=useState(null);
  // despesas
  const [exps,setExps]=useState([]);
  const [expForm,setExpForm]=useState(null);
  // repasse
  const [rep,setRep]=useState([]);
  // projeção
  const [proj,setProj]=useState(null);
  const [saldoIni,setSaldoIni]=useState('0');
  const [comissao,setComissao]=useState([]);
  const [editPctId,setEditPctId]=useState(null);
  const [editPctVal,setEditPctVal]=useState('');
  // contas a receber
  const [contas,setContas]=useState([]);
  const [contasLoading,setContasLoading]=useState(false);
  const [contasFiltStatus,setContasFiltStatus]=useState('');
  const [contasFiltCliente,setContasFiltCliente]=useState('');
  const [contasPage,setContasPage]=useState(0);
  const CONTAS_PER_PAGE=20;
  // resumo por aluno
  const [alunos,setAlunos]=useState([]);
  const [selAluno,setSelAluno]=useState('');
  const [selMes,setSelMes]=useState(TODAY.slice(0,7));
  const [selResumoStatus,setSelResumoStatus]=useState('');
  const [resumo,setResumo]=useState(null);
  const [resumoLoading,setResumoLoading]=useState(false);
  const [emailSending,setEmailSending]=useState(false);
  const [waSending,setWaSending]=useState(false);

  const CF_EMPTY={receitas:{reservas:{total:0,count:0},bar:{total:0,count:0},manutencao:{total:0,count:0},planos:{total:0,count:0},total:0},despesas:{total:0,count:0},saldo:0};
  const [cfLoading,setCfLoading]=useState(false);
  const loadFluxo=useCallback(()=>{setCfLoading(true);setCf(null);financeApi.cashflow({from,to}).then(d=>{setCf(d);setCfLoading(false);}).catch(()=>{setCf(CF_EMPTY);setCfLoading(false);});},[from,to]);
  const loadExps =useCallback(()=>{expenseApi.list({from,to}).then(setExps).catch(()=>{});},[from,to]);
  const loadRep  =useCallback(()=>{repasseApi.list({from,to}).then(setRep).catch(()=>{});},[from,to]);
  const loadProj =useCallback(()=>{financeApi.projecao({saldoInicial:parseFloat(saldoIni)||0}).then(setProj).catch(()=>{});},[saldoIni]);
  const loadComissao=useCallback(()=>{comissaoGerenteApi.list({from,to}).then(setComissao).catch(()=>{});},[from,to]);
  const loadContas=useCallback(()=>{
    setContasLoading(true);
    const p={from,to};if(contasFiltStatus)p.status=contasFiltStatus;
    contasApi.list(p).then(setContas).catch(()=>setContas([])).finally(()=>setContasLoading(false));
  },[from,to,contasFiltStatus]);

  useEffect(()=>{
    if(tab==='fluxo')loadFluxo();
    if(tab==='despesas')loadExps();
    if(tab==='repasse')loadRep();
    if(tab==='projecao')loadProj();
    if(tab==='comissao')loadComissao();
    if(tab==='contas')loadContas();
    if(tab==='resumo')contasApi.clientesFinanceiros().then(nomes=>setAlunos(nomes.map(n=>({nome:n})))).catch(()=>{});
  },[tab,loadFluxo,loadExps,loadRep,loadProj,loadComissao,loadContas]);

  const saveExp=async()=>{
    try{
      const body={...expForm,valor:parseFloat(expForm.valor)||0};
      if(expForm.id)await expenseApi.update(expForm.id,body);
      else await expenseApi.create(body);
      setExpForm(null);loadExps();showToast&&showToast('Despesa salva','success');
    }catch(e){showToast&&showToast(e.message||'Erro','error');}
  };
  const delExp=async(id)=>{if(!confirm('Excluir despesa?'))return;await expenseApi.remove(id);loadExps();};
  const pagarRep=async(professor_id)=>{
    if(!confirm('Marcar todo o repasse pendente do período como pago?'))return;
    try{await repasseApi.marcar({professor_id,from,to});loadRep();showToast&&showToast('Repasse marcado como pago','success');}
    catch(e){showToast&&showToast(e.message||'Erro','error');}
  };

  const totExp=exps.reduce((s,e)=>s+Number(e.valor||0),0);

  return<div className="p-6">
    <div className="flex items-center justify-between mb-6">
      <div><h1 className="text-2xl font-black text-gray-900">Financeiro</h1>
      <p className="text-sm text-gray-400">Fluxo de caixa, despesas e repasse de professores</p></div>
    </div>

    {/* período */}
    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 flex flex-wrap gap-3 items-end">
      <div className="w-40"><p className="text-xs text-gray-400 mb-1 font-medium">De</p><Inp type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
      <div className="w-40"><p className="text-xs text-gray-400 mb-1 font-medium">Até</p><Inp type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
      <div className="ml-auto flex gap-2">
        <Btn variant="secondary" size="sm" onClick={()=>downloadReport(`/reports/reservas.xlsx?from=${from}&to=${to}`,`reservas_${from}_${to}.xlsx`).catch(()=>showToast&&showToast('Erro no relatório','error'))}>⬇ Reservas .xlsx</Btn>
        <Btn variant="secondary" size="sm" onClick={()=>downloadReport(`/reports/financeiro.xlsx?from=${from}&to=${to}`,`financeiro_${from}_${to}.xlsx`).catch(()=>showToast&&showToast('Erro no relatório','error'))}>⬇ Financeiro .xlsx</Btn>
      </div>
    </div>

    {/* tabs */}
    <div className="border-b border-gray-200 mb-5"><nav className="flex gap-1 flex-wrap">
      {[{k:'fluxo',l:'Fluxo de Caixa'},{k:'projecao',l:'Projeção'},{k:'despesas',l:'Despesas'},{k:'repasse',l:'Repasse Professores'},{k:'contas',l:'💳 Contas a Receber'},{k:'resumo',l:'📋 Resumo por Aluno'},{k:'comissao',l:'🏷️ Comissão Gerente'}].map(t=>
        <button key={t.k} onClick={()=>setTab(t.k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${tab===t.k?'border-emerald-600 text-emerald-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.l}</button>)}
    </nav></div>

    {tab==='fluxo'&&(cfLoading
      ?<div className="text-center py-10 text-gray-400"><Spinner/></div>
      :cf
        ?<div>
          {cf.receitas.total===0&&cf.despesas.total===0
            ?<div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">📊</p><p className="text-lg font-medium">Sem atividade no período</p><p className="text-sm mt-1">Nenhuma receita ou despesa registrada entre as datas selecionadas.</p></div>
            :<div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                {[['Receita Total',cf.receitas.total,'#16a34a'],['Despesas',cf.despesas.total,'#dc2626'],['Saldo',cf.saldo,cf.saldo>=0?'#0284c7':'#dc2626']].map(([l,v,c])=>
                  <div key={l} className="bg-white rounded-2xl border border-gray-100 p-4"><p className="text-xs text-gray-400 mb-1">{l}</p><p className="text-xl font-black" style={{color:c}}>{fmt$(v)}</p></div>)}
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h3 className="font-bold text-gray-700 mb-3">Composição da Receita</h3>
                {[['Reservas',cf.receitas.reservas],['Bar',cf.receitas.bar],['Loja & Equip.',cf.receitas.manutencao||{total:0,count:0}],['Planos/Aulas',cf.receitas.planos]].map(([l,o])=>
                  <div key={l} className="flex justify-between py-1.5 border-b border-gray-50 text-sm"><span className="text-gray-600">{l} <span className="text-gray-400">({o?.count||0})</span></span><span className="font-semibold text-gray-800">{fmt$(o?.total||0)}</span></div>)}
              </div>
            </div>}
        </div>
        :<div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">📊</p><p>Sem atividade no período</p></div>)}

    {tab==='projecao'&&<div>
      <div className="flex items-end gap-3 mb-5">
        <div className="w-48"><p className="text-xs text-gray-400 mb-1 font-medium">Saldo inicial em caixa (R$)</p>
          <Inp type="number" value={saldoIni} onChange={e=>setSaldoIni(e.target.value)}/></div>
        <Btn variant="secondary" size="sm" onClick={loadProj}>Recalcular</Btn>
      </div>
      {proj?<div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5">
          <h3 className="font-bold text-gray-700 mb-3">Recorrência mensal estimada</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div><p className="text-gray-400">Receita recorrente</p><p className="font-semibold text-emerald-700">{fmt$(proj.mensal.receita)}</p></div>
            <div><p className="text-gray-400">Folha</p><p className="font-semibold text-red-600">{fmt$(proj.mensal.folha)}</p></div>
            <div><p className="text-gray-400">Despesas recorrentes</p><p className="font-semibold text-red-600">{fmt$(proj.mensal.despesa_recorrente)}</p></div>
            <div><p className="text-gray-400">Líquido/mês</p><p className="font-bold" style={{color:proj.mensal.liquido>=0?'#0284c7':'#dc2626'}}>{fmt$(proj.mensal.liquido)}</p></div>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {proj.projecao.map(p=><div key={p.dias} className="bg-white rounded-2xl border border-gray-100 p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">{p.dias} dias</p>
            <p className="text-lg font-black" style={{color:p.saldo_projetado>=0?'#16a34a':'#dc2626'}}>{fmt$(p.saldo_projetado)}</p>
            <p className="text-[11px] text-gray-400 mt-1">saldo projetado</p>
          </div>)}
        </div>
        <p className="text-xs text-gray-400 mt-3">Projeção = saldo inicial + (receita recorrente − folha − despesas recorrentes) × meses − despesas pontuais futuras a vencer no período. Receita avulsa não entra.</p>
      </div>:<div className="text-center py-10 text-gray-400">Carregando...</div>}
    </div>}

    {tab==='despesas'&&<div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">Total no período: <strong className="text-gray-800">{fmt$(totExp)}</strong></p>
        <Btn size="sm" onClick={()=>setExpForm({categoria:'aluguel',valor:'',vencimento:to,recorrencia:'nenhuma',pago:false})}>+ Nova Despesa</Btn>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 bg-gray-50">{['Categoria','Descrição','Vencimento','Valor','Status',''].map((h,i)=><th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">
          {exps.length===0&&<tr><td colSpan={6} className="text-center py-10 text-gray-400">Nenhuma despesa</td></tr>}
          {exps.map(e=><tr key={e.id} className="hover:bg-gray-50">
            <td className="px-3 py-2.5 text-gray-700">{EXP_CAT_LABEL[e.categoria]||e.categoria}</td>
            <td className="px-3 py-2.5 text-gray-500">{e.descricao||'—'}</td>
            <td className="px-3 py-2.5 text-gray-600">{e.vencimento?new Date(e.vencimento).toLocaleDateString('pt-BR'):'—'}</td>
            <td className="px-3 py-2.5 font-semibold text-gray-800">{fmt$(e.valor)}</td>
            <td className="px-3 py-2.5">{e.pago?<span className="text-xs font-semibold px-2 py-0.5 rounded text-emerald-700 bg-emerald-50">Pago</span>:<span className="text-xs font-semibold px-2 py-0.5 rounded text-amber-700 bg-amber-50">Pendente</span>}</td>
            <td className="px-3 py-2.5 text-right whitespace-nowrap"><button onClick={()=>setExpForm({...e,vencimento:e.vencimento?.slice(0,10),pago_em:e.pago_em?.slice(0,10)})} className="text-gray-400 hover:text-emerald-600 mr-2">✏️</button><button onClick={()=>delExp(e.id)} className="text-gray-400 hover:text-red-600">🗑️</button></td>
          </tr>)}
        </tbody>
      </table></div></div>
    </div>}

    {tab==='repasse'&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="border-b border-gray-100 bg-gray-50">{['Professor','%','Planos','Total Planos','Repasse Devido','Pendente',''].map((h,i)=><th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-50">
        {rep.length===0&&<tr><td colSpan={7} className="text-center py-10 text-gray-400">Nenhum repasse no período</td></tr>}
        {rep.map(r=><tr key={r.professor_id} className="hover:bg-gray-50">
          <td className="px-3 py-2.5 font-medium text-gray-800">{r.nome}</td>
          <td className="px-3 py-2.5 text-gray-600">{Number(r.percentual_repasse)}%</td>
          <td className="px-3 py-2.5 text-gray-600">{r.qtd_planos}</td>
          <td className="px-3 py-2.5 text-gray-600">{fmt$(r.total_planos)}</td>
          <td className="px-3 py-2.5 font-semibold text-emerald-700">{fmt$(r.repasse_devido)}</td>
          <td className="px-3 py-2.5 text-amber-700">{fmt$(r.total_pendente)}</td>
          <td className="px-3 py-2.5 text-right">{Number(r.total_pendente)>0&&<Btn size="sm" variant="secondary" onClick={()=>pagarRep(r.professor_id)}>Marcar pago</Btn>}</td>
        </tr>)}
      </tbody>
    </table></div></div>}

    {/* aba contas a receber */}
    {tab==='contas'&&<div>
      {/* cards resumo por status */}
      {contas.length>0&&(()=>{
        const totPago=contas.filter(c=>c.status_pgto==='pago').reduce((s,c)=>s+Number(c.total),0);
        const totPendente=contas.filter(c=>!c.status_pgto||c.status_pgto==='pendente').reduce((s,c)=>s+Number(c.total),0);
        const totAtrasado=contas.filter(c=>c.status_pgto==='em_atraso').reduce((s,c)=>s+Number(c.total),0);
        const totGeral=contas.reduce((s,c)=>s+Number(c.total),0);
        return<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[['Total do Período',totGeral,'#374151'],['✅ Recebido',totPago,'#16a34a'],['⏳ Pendente',totPendente,'#b45309'],['🔴 Em Atraso',totAtrasado,'#dc2626']].map(([l,v,c])=>
            <div key={l} className="bg-white rounded-2xl border border-gray-100 p-3 shadow-sm">
              <p className="text-xs text-gray-400 mb-0.5">{l}</p>
              <p className="text-lg font-black" style={{color:c}}>{fmt$(v)}</p>
            </div>)}
        </div>;
      })()}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="w-48">
          <p className="text-xs text-gray-400 mb-1 font-medium">Filtrar por status</p>
          <select value={contasFiltStatus} onChange={e=>{setContasFiltStatus(e.target.value);setContasPage(0);}} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
            <option value="">Todos</option>
            {PGTO_STATUS_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="w-56">
          <p className="text-xs text-gray-400 mb-1 font-medium">Filtrar por cliente</p>
          <input value={contasFiltCliente} onChange={e=>{setContasFiltCliente(e.target.value);setContasPage(0);}} placeholder="Nome do cliente..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"/>
        </div>
        <Btn variant="secondary" size="sm" onClick={loadContas}>🔄 Atualizar</Btn>
        {(()=>{const cf=contas.filter(c=>!contasFiltCliente||((c.cliente||'').toLowerCase().includes(contasFiltCliente.toLowerCase())));return<div className="ml-auto text-sm text-gray-500">{cf.length} registro{cf.length!==1?'s':''} •{' '}<strong className="text-emerald-700">{fmt$(cf.reduce((s,c)=>s+Number(c.total),0))}</strong></div>;})()}
      </div>
      {contasLoading?<Spinner/>:(()=>{
        const cf=contas.filter(c=>!contasFiltCliente||((c.cliente||'').toLowerCase().includes(contasFiltCliente.toLowerCase())));
        const totalPages=Math.ceil(cf.length/CONTAS_PER_PAGE)||1;
        const page=Math.min(contasPage,totalPages-1);
        const pageItems=cf.slice(page*CONTAS_PER_PAGE,(page+1)*CONTAS_PER_PAGE);
        if(cf.length===0)return<div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">💳</p><p>Nenhum registro encontrado no período</p></div>;
        return<div>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {['Tipo','Cliente','Estabelecimento','Data','Valor','Status','Forma Pgto'].map(h=><th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {pageItems.map(c=>{
                  const updatePgto=async(field,val)=>{
                    await contasApi.updatePgto(c.tipo,c.id,{[field]:val}).catch(()=>{});
                    loadContas();
                  };
                  return<tr key={`${c.tipo}-${c.id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className="text-xs font-semibold">{TIPO_LABEL[c.tipo]||c.tipo}</span></td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{c.cliente||'—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{c.est_name||'—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{c.data?fmtDate(c.data.split('T')[0]):'—'}</td>
                    <td className="px-3 py-2.5 font-bold text-gray-800 whitespace-nowrap">{fmt$(c.total)}</td>
                    <td className="px-3 py-2.5">
                      <select value={c.status_pgto||'pendente'} onChange={e=>updatePgto('status_pgto',e.target.value)}
                        className={`text-xs font-semibold px-2 py-1 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-400 ${PGTO_STATUS_BADGE[c.status_pgto||'pendente']}`}>
                        {PGTO_STATUS_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <select value={c.forma_pgto||''} onChange={e=>updatePgto('forma_pgto',e.target.value)}
                        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400">
                        <option value="">— selecione —</option>
                        {PGTO_FORMA_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table></div>
          </div>
          {totalPages>1&&<div className="flex items-center justify-between mt-3 px-1">
            <span className="text-xs text-gray-400">Página {page+1} de {totalPages} ({cf.length} registros)</span>
            <div className="flex gap-1">
              <button onClick={()=>setContasPage(0)} disabled={page===0} className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 disabled:opacity-30 hover:bg-gray-50">«</button>
              <button onClick={()=>setContasPage(p=>Math.max(0,p-1))} disabled={page===0} className="px-3 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 disabled:opacity-30 hover:bg-gray-50">‹ Anterior</button>
              <button onClick={()=>setContasPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1} className="px-3 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 disabled:opacity-30 hover:bg-gray-50">Próximo ›</button>
              <button onClick={()=>setContasPage(totalPages-1)} disabled={page>=totalPages-1} className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 disabled:opacity-30 hover:bg-gray-50">»</button>
            </div>
          </div>}
        </div>;
      })()}
    </div>}

    {/* aba resumo por aluno */}
    {tab==='resumo'&&<div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="w-64">
            <p className="text-xs text-gray-400 mb-1 font-medium">Aluno / Professor</p>
            <select value={selAluno} onChange={e=>setSelAluno(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
              <option value="">Selecione...</option>
              {alunos.map((a,i)=><option key={i} value={a.nome}>{a.nome}</option>)}
            </select>
          </div>
          <div className="w-40">
            <p className="text-xs text-gray-400 mb-1 font-medium">Mês <span className="text-gray-300">(opcional)</span></p>
            <input type="month" value={selMes} onChange={e=>setSelMes(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
          </div>
          <div className="w-44">
            <p className="text-xs text-gray-400 mb-1 font-medium">Status</p>
            <select value={selResumoStatus} onChange={e=>setSelResumoStatus(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
              <option value="">Todos</option>
              <option value="pendente">Em aberto</option>
              <option value="pago">Pago</option>
              <option value="em_atraso">Em atraso</option>
            </select>
          </div>
          <Btn disabled={!selAluno||resumoLoading} onClick={()=>{
            if(!selAluno)return;
            setResumoLoading(true);
            const params={aluno_nome:selAluno};
            if(selMes)params.mes=selMes;
            if(selResumoStatus)params.status_pgto=selResumoStatus;
            contasApi.resumoAluno(params)
              .then(setResumo).catch(()=>{}).finally(()=>setResumoLoading(false));
          }}>{resumoLoading?'Buscando...':'🔍 Gerar Resumo'}</Btn>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>{if(!selAluno){return;}setSelMes('');setSelResumoStatus('pendente');setResumoLoading(true);contasApi.resumoAluno({aluno_nome:selAluno,status_pgto:'pendente'}).then(setResumo).catch(()=>{}).finally(()=>setResumoLoading(false));}}
            className="text-xs font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors">
            🔴 Ver todas as pendências
          </button>
          <button onClick={()=>{if(!selAluno)return;setSelMes('');setSelResumoStatus('em_atraso');setResumoLoading(true);contasApi.resumoAluno({aluno_nome:selAluno,status_pgto:'em_atraso'}).then(setResumo).catch(()=>{}).finally(()=>setResumoLoading(false));}}
            className="text-xs font-medium text-amber-600 border border-amber-200 bg-amber-50 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-colors">
            ⚠️ Apenas em atraso
          </button>
          {selMes&&<button onClick={()=>setSelMes('')} className="text-xs text-gray-400 border border-gray-200 rounded-lg px-3 py-1.5 hover:text-gray-600">✕ Limpar mês</button>}
        </div>
        {!selAluno&&<p className="text-xs text-gray-400">Selecione um aluno para ver o histórico financeiro.</p>}
      </div>

      {resumoLoading&&<Spinner text="Gerando resumo..."/>}
      {!resumoLoading&&resumo&&<div>
        <div id="resumo-aluno-print">
          <div className="flex items-center justify-between mb-4 print:hidden">
            <h2 className="text-lg font-black text-gray-800">{resumo.modo==='pendencias_gerais'?'🔴 Pendências em Aberto — '+resumo.aluno_nome:'Resumo de '+resumo.aluno_nome+' — '+new Date((resumo.mes||selMes)+'-15').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</h2>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" onClick={()=>window.print()}>🖨️ Imprimir</Btn>
              <Btn variant="secondary" size="sm" disabled={emailSending} onClick={async()=>{
                const email=(resumo.aulas||[]).map(a=>a.email_aluno).find(Boolean)||(resumo.reservas||[]).map(r=>r.client_email).find(Boolean);
                if(!email){showToast&&showToast('Aluno sem email cadastrado','error');return;}
                setEmailSending(true);
                try{await contasApi.emailAluno({aluno_nome:resumo.aluno_nome,aluno_email:email,mes:selMes,resumo});showToast&&showToast('Email enviado!','success');}
                catch(e){showToast&&showToast(e.message||'Erro ao enviar','error');}
                finally{setEmailSending(false);}
              }}>{emailSending?'Enviando...':'📧 Enviar por Email'}</Btn>
              <Btn variant="secondary" size="sm" disabled={waSending} onClick={async()=>{
                setWaSending(true);
                try{await contasApi.whatsappAluno({aluno_nome:resumo.aluno_nome,mes:resumo.mes||null,resumo});showToast&&showToast('WhatsApp enviado!','success');}
                catch(e){showToast&&showToast(e.message||'Erro ao enviar WhatsApp','error');}
                finally{setWaSending(false);}
              }}>{waSending?'Enviando...':'💬 Enviar por WhatsApp'}</Btn>
            </div>
          </div>

          {/* totais */}
          {resumo.modo==='pendencias_gerais'&&Number(resumo.totais.geral)>0&&<div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-center gap-4">
            <span className="text-3xl">🔴</span>
            <div><p className="text-xs text-red-500 font-semibold uppercase tracking-wide">Total Pendente</p>
            <p className="text-2xl font-black text-red-600">{fmt$(resumo.totais.geral)}</p></div>
          </div>}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
            {[['Aulas/Planos',resumo.totais.aulas,'#7c3aed'],['Reservas',resumo.totais.reservas,'#0284c7'],['Bar',resumo.totais.bar,'#b45309'],['Loja & Equip.',resumo.totais.manutencao||0,'#4b5563'],['Total Geral',resumo.totais.geral,'#16a34a']].map(([l,v,c])=>
              <div key={l} className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-xs text-gray-400 mb-1">{l}</p>
                <p className="text-xl font-black" style={{color:c}}>{fmt$(v)}</p>
              </div>)}
          </div>

          {/* aulas */}
          {resumo.aulas.length>0&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
            <div className="px-4 py-3 bg-purple-50 border-b border-purple-100"><h3 className="font-bold text-purple-700 text-sm">📚 Aulas / Planos ({resumo.aulas.length})</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><tbody className="divide-y divide-gray-50">
              {resumo.aulas.map(a=><tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-600">{a.tipo||'Aula'}</td>
                <td className="px-4 py-2.5 text-gray-500">{a.data?fmtDate(a.data.split('T')[0]):'—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{a.est_name||'—'}</td>
                <td className="px-4 py-2.5 font-semibold text-gray-800 text-right">{fmt$(a.total)}</td>
                <td className="px-4 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded ${PGTO_STATUS_BADGE[a.status_pgto||'pendente']}`}>{a.status_pgto||'pendente'}</span></td>
              </tr>)}
            </tbody></table></div>
          </div>}

          {/* reservas */}
          {resumo.reservas.length>0&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100"><h3 className="font-bold text-blue-700 text-sm">📅 Reservas ({resumo.reservas.length})</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><tbody className="divide-y divide-gray-50">
              {resumo.reservas.map(r=><tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-600">{r.ponto_name||'Reserva'}</td>
                <td className="px-4 py-2.5 text-gray-500">{r.data?fmtDate(r.data.split('T')[0]):'—'} {r.start_time&&`${r.start_time}–${r.end_time}`}</td>
                <td className="px-4 py-2.5 text-gray-500">{r.est_name||'—'}</td>
                <td className="px-4 py-2.5 font-semibold text-gray-800 text-right">{fmt$(r.total)}</td>
                <td className="px-4 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded ${PGTO_STATUS_BADGE[r.status_pgto||'pendente']}`}>{r.status_pgto||'pendente'}</span></td>
              </tr>)}
            </tbody></table></div>
          </div>}

          {/* bar */}
          {resumo.bar.length>0&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-100"><h3 className="font-bold text-amber-700 text-sm">🍺 Consumo Bar ({resumo.bar.length})</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><tbody className="divide-y divide-gray-50">
              {resumo.bar.map(b=><tr key={b.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-600 text-xs">{(b.itens||[]).map(i=>`${i.nome} ×${i.quantidade}`).join(', ')||'—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{b.data?fmtDate(b.data.split('T')[0]):'—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{b.est_name||'—'}</td>
                <td className="px-4 py-2.5 font-semibold text-gray-800 text-right">{fmt$(b.total)}</td>
                <td className="px-4 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded ${PGTO_STATUS_BADGE[b.status_pgto||'pendente']}`}>{b.status_pgto||'pendente'}</span></td>
              </tr>)}
            </tbody></table></div>
          </div>}

          {/* manutenção */}
          {resumo.manutencao?.length>0&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200"><h3 className="font-bold text-gray-700 text-sm">🛒 Loja & Equipamentos ({resumo.manutencao.length})</h3></div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><tbody className="divide-y divide-gray-50">
              {resumo.manutencao.map(m=><tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-600 text-xs">{(m.itens||[]).map(i=>`${i.nome} ×${i.quantidade}`).join(', ')||'—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{m.data?fmtDate(m.data.split('T')[0]):'—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{m.est_name||'—'}</td>
                <td className="px-4 py-2.5 font-semibold text-gray-800 text-right">{fmt$(m.total)}</td>
                <td className="px-4 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded ${PGTO_STATUS_BADGE[m.status_pgto||'pendente']}`}>{m.status_pgto||'pendente'}</span></td>
              </tr>)}
            </tbody></table></div>
          </div>}

          {resumo.aulas.length===0&&resumo.reservas.length===0&&resumo.bar.length===0&&!(resumo.manutencao?.length>0)&&
            <div className="text-center py-16 text-gray-400"><p className="text-4xl mb-2">🔍</p>
            <p>{resumo.modo==='pendencias_gerais'?<>Nenhuma pendência encontrada para <strong>{resumo.aluno_nome}</strong>. Tudo em dia! ✅</>:<>Nenhum registro para <strong>{resumo.aluno_nome}</strong> em {new Date((resumo.mes||selMes)+'-15').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</>}</p></div>}
        </div>
      </div>}
    </div>}

    {/* modal despesa */}
    <Modal open={!!expForm} onClose={()=>setExpForm(null)} title={expForm?.id?'Editar Despesa':'Nova Despesa'}>
      {expForm&&<div className="space-y-3">
        <Field label="Categoria" required><Sel value={expForm.categoria} onChange={e=>setExpForm(p=>({...p,categoria:e.target.value}))} options={EXP_CATS}/></Field>
        <Field label="Descrição"><Inp value={expForm.descricao||''} onChange={e=>setExpForm(p=>({...p,descricao:e.target.value}))}/></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$)" required><Inp type="number" value={expForm.valor} onChange={e=>setExpForm(p=>({...p,valor:e.target.value}))}/></Field>
          <Field label="Vencimento" required><Inp type="date" value={expForm.vencimento||''} onChange={e=>setExpForm(p=>({...p,vencimento:e.target.value}))}/></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recorrência"><Sel value={expForm.recorrencia} onChange={e=>setExpForm(p=>({...p,recorrencia:e.target.value}))} options={[{value:'nenhuma',label:'Única'},{value:'mensal',label:'Mensal'},{value:'anual',label:'Anual'}]}/></Field>
          <Field label="Status"><Sel value={expForm.pago?'sim':'nao'} onChange={e=>setExpForm(p=>({...p,pago:e.target.value==='sim'}))} options={[{value:'nao',label:'Pendente'},{value:'sim',label:'Pago'}]}/></Field>
        </div>
        <div className="flex gap-3 pt-2"><Btn variant="secondary" className="flex-1" onClick={()=>setExpForm(null)}>Cancelar</Btn><Btn className="flex-1" onClick={saveExp}>Salvar</Btn></div>
      </div>}
    </Modal>
    {tab==='comissao'&&<div className="space-y-4">
      {isAdmin&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>{['Gerente','Estabelecimento','Comissão %','Reservas','Total','Devida','Pendente',''].map((h,i)=>
              <th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {comissao.length===0&&<tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Nenhum gerente cadastrado</td></tr>}
            {comissao.map((g,i)=><tr key={i} className="hover:bg-gray-50">
              <td className="px-3 py-2.5 font-semibold text-gray-800">{g.gerente_nome}</td>
              <td className="px-3 py-2.5 text-gray-500">{g.est_nome}</td>
              <td className="px-3 py-2.5">
                {editPctId===g.gerente_id?(
                  <span className="flex items-center gap-1">
                    <input type="number" min="0" max="100" step="0.5" value={editPctVal}
                      onChange={e=>setEditPctVal(e.target.value)}
                      className="w-16 border border-gray-300 rounded px-1.5 py-1 text-sm text-center"/>
                    <button onClick={async()=>{try{await comissaoGerenteApi.setPercentual(g.gerente_id,editPctVal);setEditPctId(null);loadComissao();showToast('% atualizado','success');}catch(e){showToast(e.message,'error');}}} className="text-emerald-600 text-xs font-semibold hover:underline">✓</button>
                    <button onClick={()=>setEditPctId(null)} className="text-gray-400 text-xs hover:underline">✕</button>
                  </span>
                ):(
                  <span className="cursor-pointer hover:text-emerald-600 text-sm" onClick={()=>{setEditPctId(g.gerente_id);setEditPctVal(String(g.percentual_comissao));}}>
                    {g.percentual_comissao}% ✎
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-gray-500">{g.qtd_reservas}</td>
              <td className="px-3 py-2.5">{fmt$(g.total_reservas)}</td>
              <td className="px-3 py-2.5 font-semibold">{fmt$(g.comissao_devida)}</td>
              <td className="px-3 py-2.5">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${Number(g.comissao_pendente)>0?'bg-amber-100 text-amber-700':'bg-emerald-100 text-emerald-700'}`}>{fmt$(g.comissao_pendente)}</span>
              </td>
              <td className="px-3 py-2.5 text-right">
                {Number(g.comissao_pendente)>0&&<Btn size="sm" variant="secondary" onClick={async()=>{try{await comissaoGerenteApi.marcarPago(g.gerente_id);loadComissao();showToast('Comissão marcada como paga','success');}catch(e){showToast(e.message,'error');}}}>Marcar pago</Btn>}
              </td>
            </tr>)}
          </tbody>
        </table></div>
      </div>}
      {!isAdmin&&<div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-3">
        {comissao.length===0?<p className="text-gray-400 text-center py-8">Sem dados de comissão no período</p>
        :comissao.map((g,i)=><div key={i} className="flex justify-between items-center py-3 border-b border-gray-50 last:border-0">
          <div>
            <p className="font-semibold text-gray-800">{g.est_nome}</p>
            <p className="text-sm text-gray-400">{g.percentual_comissao}% sobre aluguéis • {g.qtd_reservas} reserva{g.qtd_reservas!==1?'s':''}</p>
          </div>
          <div className="text-right">
            <p className="font-bold text-emerald-700 text-lg">{fmt$(g.comissao_devida)}</p>
            <p className="text-xs text-amber-600">Pendente: {fmt$(g.comissao_pendente)}</p>
          </div>
        </div>)}
      </div>}
    </div>}
  </div>;
}

// ================================================================
// CRM ESTOQUE DO BAR
// ================================================================
function CRMEstoque({crmUser,showToast}){
  const [ests,setEsts]=useState([]);
  const [selEst,setSelEst]=useState('');
  const [prods,setProds]=useState([]);
  const [form,setForm]=useState(null);
  const isAdmin=crmUser.role==='admin';
  const canEdit=isAdmin||crmUser.role==='manager';

  useEffect(()=>{estApi.list().then(setEsts).catch(()=>{});},[]);
  const load=useCallback(()=>{barProdutoApi.list(selEst||undefined).then(setProds).catch(()=>{});},[selEst]);
  useEffect(()=>{load();},[load]);

  const save=async()=>{
    try{
      const body={...form,preco:parseFloat(form.preco)||0,estoque:parseInt(form.estoque)||0,estoque_min:parseInt(form.estoque_min)||0};
      if(form.id)await barProdutoApi.update(form.id,body);else await barProdutoApi.create(body);
      setForm(null);load();showToast&&showToast('Produto salvo','success');
    }catch(e){showToast&&showToast(e.message||'Erro','error');}
  };
  const ajustar=async(p,delta)=>{await barProdutoApi.estoque(p.id,delta);load();};
  const del=async(id)=>{if(!confirm('Excluir produto?'))return;await barProdutoApi.remove(id);load();};

  return<div className="p-6">
    <div className="flex items-center justify-between mb-6">
      <div><h1 className="text-2xl font-black text-gray-900">Estoque do Bar</h1>
      <p className="text-sm text-gray-400">Produtos e baixa automática nas vendas</p></div>
      <Btn onClick={()=>setForm({est_id:selEst||'',nome:'',preco:'',estoque:0,estoque_min:0})}>+ Novo Produto</Btn>
    </div>
    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 w-72">
      <Sel value={selEst} onChange={e=>setSelEst(e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Todos os estabelecimentos"/>
    </div>
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="border-b border-gray-100 bg-gray-50">{['Produto','Preço','Estoque','Mín.','Ajuste',''].map((h,i)=><th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-50">
        {prods.length===0&&<tr><td colSpan={6} className="text-center py-10 text-gray-400">Nenhum produto</td></tr>}
        {prods.map(p=>{const baixo=Number(p.estoque)<=Number(p.estoque_min);return<tr key={p.id} className="hover:bg-gray-50">
          <td className="px-3 py-2.5 font-medium text-gray-800">{p.nome}</td>
          <td className="px-3 py-2.5 text-gray-600">{fmt$(p.preco)}</td>
          <td className="px-3 py-2.5"><span className={`font-semibold ${baixo?'text-red-600':'text-gray-800'}`}>{p.estoque}{baixo&&' ⚠️'}</span></td>
          <td className="px-3 py-2.5 text-gray-400">{p.estoque_min}</td>
          <td className="px-3 py-2.5"><button onClick={()=>ajustar(p,-1)} className="px-2 text-gray-500 hover:text-red-600">−</button><button onClick={()=>ajustar(p,1)} className="px-2 text-gray-500 hover:text-emerald-600">+</button></td>
          <td className="px-3 py-2.5 text-right whitespace-nowrap"><button onClick={()=>setForm({...p})} className="text-gray-400 hover:text-emerald-600 mr-2">✏️</button>{canEdit&&<button onClick={()=>del(p.id)} className="text-gray-400 hover:text-red-600">🗑️</button>}</td>
        </tr>;})}
      </tbody>
    </table></div></div>
    <Modal open={!!form} onClose={()=>setForm(null)} title={form?.id?'Editar Produto':'Novo Produto'}>
      {form&&<div className="space-y-3">
        <Field label="Estabelecimento" required><Sel value={form.est_id} onChange={e=>setForm(p=>({...p,est_id:e.target.value}))} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/></Field>
        <Field label="Nome" required><Inp value={form.nome} onChange={e=>setForm(p=>({...p,nome:e.target.value}))}/></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Preço (R$)"><Inp type="number" value={form.preco} onChange={e=>setForm(p=>({...p,preco:e.target.value}))}/></Field>
          <Field label="Estoque"><Inp type="number" value={form.estoque} onChange={e=>setForm(p=>({...p,estoque:e.target.value}))}/></Field>
          <Field label="Mínimo"><Inp type="number" value={form.estoque_min} onChange={e=>setForm(p=>({...p,estoque_min:e.target.value}))}/></Field>
        </div>
        <div className="flex gap-3 pt-2"><Btn variant="secondary" className="flex-1" onClick={()=>setForm(null)}>Cancelar</Btn><Btn className="flex-1" onClick={save}>Salvar</Btn></div>
      </div>}
    </Modal>
  </div>;
}

// ================================================================
// AVALIAÇÕES (marketplace) — bloco reutilizável
// ================================================================
function ReviewsBlock({targetType,targetId,publicUser,showToast}){
  const [data,setData]=useState({reviews:[],total:0,media:0});
  const [nota,setNota]=useState(5);
  const [coment,setComent]=useState('');
  const [saving,setSaving]=useState(false);
  const load=useCallback(()=>{if(targetId)reviewApi.list(targetType,targetId).then(setData).catch(()=>{});},[targetType,targetId]);
  useEffect(()=>{load();},[load]);
  const enviar=async()=>{
    setSaving(true);
    try{await reviewApi.create({target_type:targetType,target_id:targetId,nota,comentario:coment});setComent('');load();showToast&&showToast('Avaliação enviada!','success');}
    catch(e){showToast&&showToast(e.message||'Erro ao avaliar','error');}
    finally{setSaving(false);}
  };
  const stars=(n)=>'★★★★★'.slice(0,n)+'☆☆☆☆☆'.slice(0,5-n);
  return<div className="bg-white rounded-2xl border border-gray-100 p-5 mt-6">
    <div className="flex items-center justify-between mb-4">
      <h3 className="font-bold text-gray-800">Avaliações</h3>
      <div className="text-sm text-gray-500">{data.total>0?<><span className="text-amber-500 text-base">{stars(Math.round(data.media))}</span> <strong>{data.media.toFixed(1)}</strong> ({data.total})</>:'Sem avaliações ainda'}</div>
    </div>
    {publicUser?<div className="bg-gray-50 rounded-xl p-3 mb-4">
      <div className="flex items-center gap-1 mb-2">{[1,2,3,4,5].map(i=><button key={i} onClick={()=>setNota(i)} className="text-2xl leading-none" style={{color:i<=nota?'#f59e0b':'#d1d5db'}}>★</button>)}</div>
      <textarea value={coment} onChange={e=>setComent(e.target.value)} rows={2} placeholder="Conte como foi sua experiência (opcional)..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"/>
      <div className="flex justify-end mt-2"><Btn size="sm" onClick={enviar} disabled={saving}>{saving?'Enviando...':'Enviar avaliação'}</Btn></div>
    </div>:<p className="text-xs text-gray-400 mb-4">Entre na sua conta para avaliar.</p>}
    <div className="space-y-3">
      {data.reviews.map(r=><div key={r.id} className="border-b border-gray-50 pb-3">
        <div className="flex items-center justify-between"><span className="text-sm font-medium text-gray-700">{r.user_name||'Cliente'}</span><span className="text-amber-500 text-sm">{stars(r.nota)}</span></div>
        {r.comentario&&<p className="text-sm text-gray-500 mt-1">{r.comentario}</p>}
      </div>)}
    </div>
  </div>;
}

// ================================================================
// CRM AUDITORIA (LGPD) — somente admin
// ================================================================
const AUDIT_ACTIONS={
  create:{label:'Criação',color:'#16a34a',bg:'#dcfce7',icon:'➕'},
  update:{label:'Edição', color:'#d97706',bg:'#fef3c7',icon:'✏️'},
  delete:{label:'Exclusão',color:'#dc2626',bg:'#fee2e2',icon:'🗑️'},
  login: {label:'Login',  color:'#2563eb',bg:'#dbeafe',icon:'🔑'},
};
const AUDIT_ENTITY={
  auth:'Autenticação',establishments:'Estabelecimentos',points:'Pontos','crm-users':'Usuários',
  reservations:'Reservas',professores:'Professores',planos:'Planos de Aula',bar:'Bar',
  manutencao:'Loja & Equipamentos','profissionais-ef':'Profissionais EF',
};
function CRMAudit({showToast}){
  const [logs,setLogs]=useState([]);
  const [total,setTotal]=useState(0);
  const [page,setPage]=useState(0);
  const [loading,setLoading]=useState(true);
  const [filters,setFilters]=useState({entities:[],users:[]});
  const [fAction,setFAction]=useState('');
  const [fEntity,setFEntity]=useState('');
  const [fUser,setFUser]=useState('');
  const [fFrom,setFFrom]=useState('');
  const [fTo,setFTo]=useState('');
  const [expanded,setExpanded]=useState(null);
  const SIZE=50;

  useEffect(()=>{auditApi.filters().then(setFilters).catch(()=>{});},[]);

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const params={limit:SIZE,offset:page*SIZE};
      if(fAction)params.action=fAction;
      if(fEntity)params.entity=fEntity;
      if(fUser)params.user_id=fUser;
      if(fFrom)params.date_from=fFrom;
      if(fTo)params.date_to=fTo;
      const r=await auditApi.list(params);
      setLogs(r.logs);setTotal(r.total);
    }catch(e){showToast&&showToast(e.message||'Erro ao carregar auditoria','error');}
    finally{setLoading(false);}
  },[page,fAction,fEntity,fUser,fFrom,fTo,showToast]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{setPage(0);},[fAction,fEntity,fUser,fFrom,fTo]);

  const pages=Math.max(1,Math.ceil(total/SIZE));
  const dt=(d)=>new Date(d).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});

  return<div className="p-6">
    <div className="flex items-center justify-between mb-6">
      <div><h1 className="text-2xl font-black text-gray-900">Auditoria</h1>
      <p className="text-sm text-gray-400">Registro de todas as ações no sistema (LGPD)</p></div>
      <Btn variant="secondary" onClick={load}>↻ Atualizar</Btn>
    </div>

    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 flex flex-wrap gap-3 items-end">
      <div className="w-36"><p className="text-xs text-gray-400 mb-1 font-medium">Ação</p>
        <Sel value={fAction} onChange={e=>setFAction(e.target.value)} options={Object.entries(AUDIT_ACTIONS).map(([k,v])=>({value:k,label:v.label}))} placeholder="Todas"/></div>
      <div className="w-44"><p className="text-xs text-gray-400 mb-1 font-medium">Módulo</p>
        <Sel value={fEntity} onChange={e=>setFEntity(e.target.value)} options={filters.entities.map(en=>({value:en,label:AUDIT_ENTITY[en]||en}))} placeholder="Todos"/></div>
      <div className="w-48"><p className="text-xs text-gray-400 mb-1 font-medium">Usuário</p>
        <Sel value={fUser} onChange={e=>setFUser(e.target.value)} options={filters.users.map(u=>({value:String(u.user_id),label:u.user_name||`#${u.user_id}`}))} placeholder="Todos"/></div>
      <div className="w-36"><p className="text-xs text-gray-400 mb-1 font-medium">De</p>
        <Inp type="date" value={fFrom} onChange={e=>setFFrom(e.target.value)}/></div>
      <div className="w-36"><p className="text-xs text-gray-400 mb-1 font-medium">Até</p>
        <Inp type="date" value={fTo} onChange={e=>setFTo(e.target.value)}/></div>
      <div className="ml-auto text-xs text-gray-400 self-center">{total.toLocaleString('pt-BR')} registro{total===1?'':'s'}</div>
    </div>

    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="border-b border-gray-100 bg-gray-50">
          {['Data/Hora','Usuário','Ação','Módulo','Registro','Status','IP',''].map((h,i)=>
            <th key={i} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-gray-50">
          {loading&&<tr><td colSpan={8} className="text-center py-10 text-gray-400">Carregando...</td></tr>}
          {!loading&&logs.length===0&&<tr><td colSpan={8} className="text-center py-12 text-gray-400"><p className="text-3xl mb-2">📭</p>Nenhum registro encontrado</td></tr>}
          {!loading&&logs.map(l=>{const a=AUDIT_ACTIONS[l.action]||{label:l.action,color:'#64748b',bg:'#f1f5f9',icon:'•'};const ok=l.status_code<400;const open=expanded===l.id;return<React.Fragment key={l.id}>
            <tr className="hover:bg-gray-50 cursor-pointer" onClick={()=>setExpanded(open?null:l.id)}>
              <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap text-xs">{dt(l.created_at)}</td>
              <td className="px-3 py-2.5 text-gray-700">{l.user_name||<span className="text-gray-300">—</span>}{l.user_role&&<span className="block text-xs text-gray-400 capitalize">{l.user_role}</span>}</td>
              <td className="px-3 py-2.5"><span className="text-xs font-semibold px-2 py-1 rounded-md whitespace-nowrap" style={{color:a.color,background:a.bg}}>{a.icon} {a.label}</span></td>
              <td className="px-3 py-2.5 text-gray-700">{AUDIT_ENTITY[l.entity]||l.entity||'—'}</td>
              <td className="px-3 py-2.5 text-gray-400 text-xs">{l.entity_id?`#${l.entity_id}`:'—'}</td>
              <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded ${ok?'text-emerald-700 bg-emerald-50':'text-red-700 bg-red-50'}`}>{l.status_code}</span></td>
              <td className="px-3 py-2.5 text-gray-400 text-xs">{l.ip||'—'}</td>
              <td className="px-3 py-2.5 text-gray-300 text-xs">{open?'▲':'▼'}</td>
            </tr>
            {open&&<tr><td colSpan={8} className="bg-gray-50 px-5 py-3">
              <p className="text-xs text-gray-500 mb-2"><strong>{l.method}</strong> {l.path}</p>
              {l.details&&<pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded-lg overflow-auto max-h-60 m-0">{JSON.stringify(l.details,null,2)}</pre>}
              {l.user_agent&&<p className="text-xs text-gray-400 mt-2">{l.user_agent}</p>}
            </td></tr>}
          </React.Fragment>;})}
        </tbody>
      </table></div>
      {total>SIZE&&<div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
        <Btn variant="secondary" size="sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}>← Anterior</Btn>
        <span className="text-xs text-gray-400">Página {page+1} de {pages}</span>
        <Btn variant="secondary" size="sm" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>Próxima →</Btn>
      </div>}
    </div>
  </div>;
}

// ================================================================
// CRM WHATSAPP — conexão via QR Code (Evolution API)
// ================================================================
function CRMWhatsApp({crmUser,showToast}){
  // ── Conexão ───────────────────────────────────────────────────────────────
  const [status,setStatus]=useState(null);
  const [qrcode,setQrcode]=useState(null);
  const [loading,setLoading]=useState(true);
  const [qrLoading,setQrLoading]=useState(false);
  const [disconnecting,setDisconnecting]=useState(false);
  // ── Automações ────────────────────────────────────────────────────────────
  const [autos,setAutos]=useState([]);   // [{type,enabled,config,last_run}]
  const [autosLoading,setAutosLoading]=useState(true);
  const [logs,setLogs]=useState([]);
  const [showLogs,setShowLogs]=useState(false);
  const [tab,setTab]=useState('conexao'); // 'conexao' | 'automacoes' | 'logs'

  const estId=crmUser?.est_id||(crmUser?.est_ids&&crmUser.est_ids[0]);

  const checkStatus=useCallback(async()=>{
    try{const s=await whatsappApi.status();setStatus(s);if(s.connected)setQrcode(null);}
    catch(e){setStatus({connected:false,state:'close',error:e.message});}
    finally{setLoading(false);}
  },[]);

  const loadAutos=useCallback(async()=>{
    try{const d=await whatsappApi.automations(estId);setAutos(d);}
    catch{}finally{setAutosLoading(false);}
  },[estId]);

  useEffect(()=>{checkStatus();loadAutos();},[checkStatus,loadAutos]);
  useEffect(()=>{
    if(!qrcode||status?.connected)return;
    const t=setInterval(checkStatus,4000);return()=>clearInterval(t);
  },[qrcode,status,checkStatus]);

  const handleConnect=async()=>{
    setQrLoading(true);setQrcode(null);
    try{const r=await whatsappApi.qrcode();
      if(r.connected){setStatus(s=>({...s,connected:true}));showToast('WhatsApp já conectado!','success');}
      else if(r.qrcode){setQrcode(r.qrcode);}
      else showToast('Não foi possível gerar QR Code','error');
    }catch(e){showToast(e.message||'Erro','error');}
    finally{setQrLoading(false);}
  };

  const handleDisconnect=async()=>{
    if(!confirm('Desconectar o WhatsApp?'))return;
    setDisconnecting(true);
    try{await whatsappApi.disconnect();setStatus(s=>({...s,connected:false,state:'close'}));setQrcode(null);showToast('WhatsApp desconectado','success');}
    catch(e){showToast(e.message||'Erro','error');}
    finally{setDisconnecting(false);}
  };

  // ── Salvar automação ──────────────────────────────────────────────────────
  const saveAuto=async(type,enabled,cfg)=>{
    try{
      const updated=await whatsappApi.saveAuto(type,{est_id:estId,enabled,config:cfg});
      setAutos(prev=>prev.map(a=>a.type===type?{...a,...updated}:a));
      showToast(enabled?'Automação ativada!':'Automação desativada','success');
    }catch(e){showToast(e.message||'Erro ao salvar','error');}
  };

  const updateAutoConfig=(type,key,val)=>{
    setAutos(prev=>prev.map(a=>a.type===type?{...a,config:{...a.config,[key]:val}}:a));
  };

  const loadLogs=async()=>{
    try{const d=await whatsappApi.logs();setLogs(d);}
    catch{setLogs([]);}
  };

  useEffect(()=>{if(tab==='logs')loadLogs();},[tab]);

  const stateLabel={open:'✅ Conectado',close:'⭕ Desconectado',connecting:'🔄 Conectando...'};

  const AUTO_META={
    cobranca_mensal:{label:'Cobrança Mensal',icon:'💰',desc:'Dispara no dia configurado do mês para todos os alunos com saldo pendente.'},
    saldo_pendente: {label:'Saldo Pendente Antigo',icon:'⏰',desc:'Avisa alunos com saldo em aberto há mais dias que o limite configurado.'},
    aniversario:    {label:'Parabéns! 🎂',icon:'🎉',desc:'Envia mensagem personalizada no dia do aniversário do aluno.'},
  };

  const fmtTs=(ts)=>ts?new Date(ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Nunca rodou';

  return<div className="p-4 md:p-6 max-w-3xl">
    <div className="mb-5">
      <h1 className="text-2xl font-black text-gray-900">WhatsApp</h1>
      <p className="text-sm text-gray-400 mt-0.5">Automações de mensagens para alunos/clientes</p>
    </div>

    {/* Tabs */}
    <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl w-fit">
      {[['conexao','📱 Conexão'],['automacoes','⚡ Automações'],['logs','📋 Histórico']].map(([k,l])=>(
        <button key={k} onClick={()=>setTab(k)}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${tab===k?'bg-white shadow text-gray-800':'text-gray-500 hover:text-gray-700'}`}>{l}</button>
      ))}
    </div>

    {/* ── Tab Conexão ── */}
    {tab==='conexao'&&<div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-center gap-4 mb-5">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-2xl">💬</div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800">Status da conexão</p>
          {loading?<p className="text-sm text-gray-400">Verificando...</p>
          :<p className={`text-sm font-semibold ${status?.connected?'text-green-600':'text-gray-500'}`}>
            {stateLabel[status?.state]||status?.state||'Desconhecido'}
          </p>}
          {!loading&&status?.instance&&<p className="text-xs text-gray-400 mt-0.5">Instância: <span className="font-mono font-medium text-gray-600">{status.instance}</span></p>}
          {!loading&&status?.connected&&status?.phone&&<p className="text-xs text-gray-400">Número: <span className="font-semibold text-gray-700">{(()=>{const d=String(status.phone).replace(/\D/g,'');return d.length>=12?`+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`:d;})()}</span>{status.profileName&&<span className="ml-2 text-gray-500">· {status.profileName}</span>}</p>}
        </div>
        <Btn variant="secondary" size="sm" className="ml-auto shrink-0" onClick={checkStatus} disabled={loading}>↻ Atualizar</Btn>
      </div>
      {status?.error&&status.error!=='Not Found'&&
        <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-4">Erro: {status.error}</div>}
      {status?.connected
        ?<div>
          <div className="bg-green-50 rounded-xl p-4 mb-4 text-center">
            <p className="text-green-700 font-semibold">✅ WhatsApp conectado com sucesso!</p>
            <p className="text-green-600 text-sm mt-1">Configure as automações na aba ⚡ Automações.</p>
          </div>
          <Btn variant="secondary" className="w-full" disabled={disconnecting} onClick={handleDisconnect}>
            {disconnecting?'Desconectando...':'🔌 Desconectar'}</Btn>
        </div>
        :<div>
          <p className="text-sm text-gray-500 mb-4">Clique em "Gerar QR Code" e escaneie com o WhatsApp do estabelecimento em <strong>Aparelhos conectados → Conectar um aparelho</strong>.</p>
          <Btn className="w-full mb-4" disabled={qrLoading} onClick={handleConnect}>
            {qrLoading?'Gerando QR Code...':'📱 Gerar QR Code'}</Btn>
          {qrcode&&<div className="text-center">
            <p className="text-xs text-gray-400 mb-3">Escaneie o QR Code com o WhatsApp do estabelecimento</p>
            <img src={qrcode} alt="QR Code" className="mx-auto rounded-xl border-4 border-green-100" style={{maxWidth:260}}/>
            <p className="text-xs text-gray-400 mt-3">O QR Code expira em ~60s.</p>
            <Btn variant="secondary" size="sm" className="mt-3" onClick={handleConnect} disabled={qrLoading}>🔄 Novo QR Code</Btn>
          </div>}
        </div>}
    </div>}

    {/* ── Tab Automações ── */}
    {tab==='automacoes'&&<div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        ⚠️ Antes de habilitar qualquer automação, certifique-se de que os <strong>cadastros de alunos, vínculos de aula e consumos</strong> estão corretos. As mensagens são enviadas com base nesses dados.
      </div>
      {autosLoading?<div className="text-center text-gray-400 py-8">Carregando...</div>
      :autos.map(auto=>{
        const meta=AUTO_META[auto.type]||{};
        const cfg=auto.config||{};
        return<div key={auto.type} className={`bg-white rounded-2xl border p-5 transition-all ${auto.enabled?'border-emerald-200':'border-gray-100'}`}>
          {/* Header com toggle */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{meta.icon}</span>
              <div>
                <p className="font-bold text-gray-800">{meta.label}</p>
                <p className="text-xs text-gray-400">{meta.desc}</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input type="checkbox" checked={!!auto.enabled} onChange={e=>saveAuto(auto.type,e.target.checked,cfg)} className="sr-only peer"/>
              <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          {/* Última execução */}
          <p className="text-xs text-gray-400 mb-3">Última execução: <span className="font-medium text-gray-600">{fmtTs(auto.last_run)}</span></p>

          {/* Config fields */}
          {auto.type==='cobranca_mensal'&&<div className="space-y-3 border-t border-gray-100 pt-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600 w-40 shrink-0">Dia do mês:</label>
              <input type="number" min="1" max="28" value={cfg.dia_do_mes??5}
                onChange={e=>updateAutoConfig('cobranca_mensal','dia_do_mes',Number(e.target.value))}
                className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"/>
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Mensagem <span className="text-gray-400 text-xs">({'{nome}'} {'{valor}'} {'{estabelecimento}'})</span>:</label>
              <textarea rows={4} value={cfg.mensagem||''} onChange={e=>updateAutoConfig('cobranca_mensal','mensagem',e.target.value)}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"/>
            </div>
            <Btn size="sm" onClick={()=>saveAuto('cobranca_mensal',!!auto.enabled,cfg)}>💾 Salvar config</Btn>
          </div>}

          {auto.type==='saldo_pendente'&&<div className="space-y-3 border-t border-gray-100 pt-3">
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Dias em atraso:</label>
                <input type="number" min="1" max="365" value={cfg.dias??45}
                  onChange={e=>updateAutoConfig('saldo_pendente','dias',Number(e.target.value))}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"/>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Frequência:</label>
                <select value={cfg.frequencia||'mensal'} onChange={e=>updateAutoConfig('saldo_pendente','frequencia',e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300">
                  <option value="mensal">Mensal</option>
                  <option value="quinzenal">Quinzenal</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-600 block mb-1">Mensagem <span className="text-gray-400 text-xs">({'{nome}'} {'{valor}'} {'{dias}'} {'{estabelecimento}'})</span>:</label>
              <textarea rows={4} value={cfg.mensagem||''} onChange={e=>updateAutoConfig('saldo_pendente','mensagem',e.target.value)}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"/>
            </div>
            <Btn size="sm" onClick={()=>saveAuto('saldo_pendente',!!auto.enabled,cfg)}>💾 Salvar config</Btn>
          </div>}

          {auto.type==='aniversario'&&<div className="space-y-3 border-t border-gray-100 pt-3">
            <div>
              <label className="text-sm text-gray-600 block mb-1">Mensagem <span className="text-gray-400 text-xs">({'{nome}'} {'{estabelecimento}'})</span>:</label>
              <textarea rows={4} value={cfg.mensagem||''} onChange={e=>updateAutoConfig('aniversario','mensagem',e.target.value)}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"/>
            </div>
            <p className="text-xs text-gray-400">💡 Dica: personalize com uma oferta especial — bebida grátis, desconto na próxima aula, etc.</p>
            <Btn size="sm" onClick={()=>saveAuto('aniversario',!!auto.enabled,cfg)}>💾 Salvar config</Btn>
          </div>}
        </div>;
      })}
    </div>}

    {/* ── Tab Histórico ── */}
    {tab==='logs'&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="font-semibold text-gray-700">Histórico de envios (últimos 100)</p>
        <Btn variant="secondary" size="sm" onClick={loadLogs}>↻ Atualizar</Btn>
      </div>
      {logs.length===0?<div className="text-center text-gray-400 py-10">Nenhum envio registrado</div>
      :<div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
        {logs.map(l=><div key={l.id} className="px-5 py-3 flex items-start gap-3">
          <span className={`mt-0.5 text-lg ${l.status==='success'?'text-green-500':'text-red-500'}`}>{l.status==='success'?'✅':'❌'}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-gray-800">{l.recipient_name}</span>
              <span className="text-xs text-gray-400">{l.recipient_phone}</span>
              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{l.automation_type?.replace('_',' ')}</span>
            </div>
            {l.status==='failed'&&<p className="text-xs text-red-500 mt-0.5">Erro: {l.error_message}</p>}
            <p className="text-xs text-gray-400 mt-0.5">{new Date(l.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>
          </div>
        </div>)}
      </div>}
    </div>}
  </div>;
}


// ================================================================
// CRM HORÁRIOS LIVRES
// ================================================================
const DOW_SHORT=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
function CRMHorariosLivres({crmUser,showToast}){
  const [ests,setEsts]=useState([]);
  const [selEst,setSelEst]=useState('');
  const [points,setPoints]=useState([]);
  const [selPoints,setSelPoints]=useState([]);
  const [from,setFrom]=useState(TODAY);
  const [to,setTo]=useState(()=>{const d=new Date(TODAY+'T12:00:00');d.setDate(d.getDate()+6);return d.toISOString().split('T')[0];});
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [viewDay,setViewDay]=useState(TODAY);

  useEffect(()=>{
    estApi.list().then(e=>{
      setEsts(e);
      const uid=crmUser&&(crmUser.est_id||(crmUser.est_ids&&crmUser.est_ids[0]));
      if(uid)setSelEst(String(uid));
    }).catch(()=>{});
  },[]);

  useEffect(()=>{
    if(!selEst){setPoints([]);setSelPoints([]);return;}
    pointApi.list(selEst).then(pts=>{setPoints(pts);setSelPoints(pts.map(p=>p.id));}).catch(()=>{});
  },[selEst]);

  const shiftWeek=(offset)=>{
    const f=new Date(from+'T12:00:00');f.setDate(f.getDate()+offset*7);
    const t=new Date(f);t.setDate(t.getDate()+6);
    const fs=f.toISOString().split('T')[0];
    const ts=t.toISOString().split('T')[0];
    setFrom(fs);setTo(ts);setViewDay(fs);setData(null);
  };

  const run=async()=>{
    if(!selEst){showToast('Selecione um estabelecimento','error');return;}
    if(!selPoints.length){showToast('Selecione ao menos uma quadra','error');return;}
    setLoading(true);setData(null);
    try{
      const d=await horariosLivresApi.get({estId:selEst,pointIds:selPoints.join(','),from,to});
      setData(d);setViewDay(from);
    }catch(e){showToast(e.message,'error');}finally{setLoading(false);}
  };

  const togglePoint=(id)=>setSelPoints(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);

  const copySummary=()=>{
    if(!data)return;
    const [y,m,d]=viewDay.split('-');
    const dow=DOW_SHORT[new Date(viewDay+'T12:00:00').getDay()];
    let txt='Quadras Livres - '+dow+' '+d+'/'+m+'/'+y+'\n\n';
    for(const pt of data.points){
      if(!selPoints.includes(pt.id))continue;
      const daySlots=data.slots[pt.id]&&data.slots[pt.id][viewDay]||{};
      const livres=Object.entries(daySlots).filter(([,v])=>v).map(([h])=>h.slice(0,5));
      txt+='🏟️ '+pt.name+'\n';
      txt+=livres.length?livres.join('  •  '):'Sem horários livres';
      txt+='\n\n';
    }
    navigator.clipboard.writeText(txt).then(()=>showToast('Copiado!','success')).catch(()=>showToast('Erro ao copiar','error'));
  };

  const allSlotKeys=data?Array.from(new Set(Object.values(data.slots).flatMap(pt=>Object.values(pt).flatMap(dd=>Object.keys(dd))))).sort():[];

  return <div className="p-6 max-w-6xl">
    <div className="mb-6">
      <h1 className="text-2xl font-black text-gray-900">🟢 Horários Livres</h1>
      <p className="text-sm text-gray-400">Visualize disponibilidade para criar campanhas de promoção</p>
    </div>

    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Estabelecimento">
          <Sel value={selEst} onChange={e=>setSelEst(e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/>
        </Field>
        <Field label="De">
          <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setData(null);}} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
        </Field>
        <Field label="Até">
          <input type="date" value={to} onChange={e=>{setTo(e.target.value);setData(null);}} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
        </Field>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={()=>shiftWeek(-1)} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">← Semana anterior</button>
        <button onClick={()=>{const t=new Date(TODAY+'T12:00:00');t.setDate(t.getDate()+6);setFrom(TODAY);setTo(t.toISOString().split('T')[0]);setData(null);}} className="text-xs text-emerald-600 border border-emerald-200 rounded-lg px-3 py-1.5 font-medium">Esta semana</button>
        <button onClick={()=>shiftWeek(1)} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">Próxima semana →</button>
      </div>

      {points.length>0&&<div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Quadras / Pontos</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>setSelPoints(selPoints.length===points.length?[]:points.map(p=>p.id))} className="text-xs border border-gray-200 rounded-full px-3 py-1 text-gray-500 hover:border-emerald-400 hover:text-emerald-600">
            {selPoints.length===points.length?'Desmarcar todos':'Marcar todos'}
          </button>
          {points.map(pt=><label key={pt.id} className={'flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border cursor-pointer transition-colors '+(selPoints.includes(pt.id)?'bg-emerald-50 border-emerald-400 text-emerald-700':'border-gray-200 text-gray-600 hover:border-gray-300')}>
            <input type="checkbox" checked={selPoints.includes(pt.id)} onChange={()=>togglePoint(pt.id)} className="w-3.5 h-3.5 accent-emerald-600"/>
            {pt.name}
          </label>)}
        </div>
      </div>}

      <Btn onClick={run} disabled={loading||!selEst||!selPoints.length} className="w-full md:w-auto">
        {loading?'Carregando...':'🔍 Ver Horários Livres'}
      </Btn>
    </div>

    {data&&<div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="border-b border-gray-100 overflow-x-auto">
        <nav className="flex gap-0 min-w-max">
          {data.days.map(day=>{
            const [dy,dm,dd]=day.split('-');
            const dow=DOW_SHORT[new Date(day+'T12:00:00').getDay()];
            const totalLivre=Object.values(data.slots).reduce((acc,pt)=>{
              const ds=pt[day]||{};return acc+Object.values(ds).filter(v=>v).length;
            },0);
            return <button key={day} onClick={()=>setViewDay(day)}
              className={'px-4 py-3 text-sm border-b-2 transition-colors whitespace-nowrap '+(viewDay===day?'border-emerald-600 text-emerald-700 font-semibold bg-emerald-50':'border-transparent text-gray-500 hover:text-gray-700')}>
              <span className="font-medium">{dow}</span>
              <span className="block text-xs">{dd}/{dm}</span>
              {totalLivre>0&&<span className="block text-xs text-emerald-500">{totalLivre} livre{totalLivre!==1?'s':''}</span>}
            </button>;
          })}
        </nav>
      </div>

      <div className="p-4">
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm font-semibold text-gray-700">{(()=>{const [dy,dm,dd]=viewDay.split('-');return DOW_SHORT[new Date(viewDay+'T12:00:00').getDay()]+', '+dd+'/'+dm+'/'+dy;})()}</p>
          <button onClick={copySummary} className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 border border-emerald-200 rounded-lg px-3 py-1.5 hover:bg-emerald-50 transition-colors">
            📋 Copiar para campanha
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left text-xs text-gray-400 font-medium py-2 pr-4 w-14">Hora</th>
                {data.points.filter(pt=>selPoints.includes(pt.id)).map(pt=>
                  <th key={pt.id} className="text-center text-xs font-bold text-gray-700 py-2 px-2 min-w-[90px]">{pt.name}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {allSlotKeys.map(slot=>{
                const visiblePts=data.points.filter(pt=>selPoints.includes(pt.id));
                const anyData=visiblePts.some(pt=>{const ds=data.slots[pt.id]&&data.slots[pt.id][viewDay]||{};return ds[slot]!==undefined;});
                if(!anyData)return null;
                return <tr key={slot} className="border-t border-gray-50">
                  <td className="text-xs text-gray-400 font-mono py-1.5 pr-4 whitespace-nowrap">{slot.slice(0,5)}</td>
                  {visiblePts.map(pt=>{
                    const ds=data.slots[pt.id]&&data.slots[pt.id][viewDay]||{};
                    const isDefined=ds[slot]!==undefined;
                    if(!isDefined)return <td key={pt.id} className="px-2 py-1.5 text-center"><span className="text-xs text-gray-200">—</span></td>;
                    return <td key={pt.id} className="px-2 py-1.5 text-center">
                      {ds[slot]
                        ?<span className="inline-block text-xs font-bold text-emerald-700 bg-emerald-100 rounded-lg px-3 py-1.5 w-full text-center">LIVRE</span>
                        :<span className="inline-block text-xs font-medium text-gray-400 bg-gray-100 rounded-lg px-3 py-1.5 w-full text-center">reservado</span>}
                    </td>;
                  })}
                </tr>;
              }).filter(Boolean)}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="inline-block w-10 text-center text-xs font-bold text-emerald-700 bg-emerald-100 rounded px-1">LIVRE</span> Disponível</div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="inline-block w-16 text-center text-xs font-medium text-gray-400 bg-gray-100 rounded px-1">reservado</span> Ocupado</div>
        </div>
      </div>
    </div>}
  </div>;
}



// Permissões padrão por role — base do sistema de perfis
const ROLE_DFLT={
  admin:      {reservas:true,horarios_livres:true,alunos:true,financeiro:true,funcionarios:true,bar:true,unimidia:true,whatsapp:true},
  manager:    {reservas:true,horarios_livres:true,alunos:true,financeiro:true,funcionarios:true,bar:true,unimidia:true,whatsapp:true},
  simples:    {reservas:true,horarios_livres:true,alunos:true,financeiro:false,funcionarios:false,bar:false,unimidia:false,whatsapp:false},
  professor:  {reservas:true,horarios_livres:true,alunos:true,financeiro:false,funcionarios:false,bar:false,unimidia:false,whatsapp:false},
  recepcao:   {reservas:true,horarios_livres:true,alunos:false,financeiro:false,funcionarios:false,bar:false,unimidia:false,whatsapp:false},
  profissional:{reservas:false,horarios_livres:false,alunos:false,financeiro:false,funcionarios:false,bar:false,unimidia:false,whatsapp:false},
};


// ─────────────────────────────────────────────────────────────────────────────
// PERFIS DE USUÁRIO — controle de permissões por usuário (admin + manager)
// ─────────────────────────────────────────────────────────────────────────────
const PERFIL_FEATURES=[
  {key:'reservas',        label:'Reservas',       icon:'📅'},
  {key:'horarios_livres', label:'Horários Livres', icon:'🟢'},
  {key:'alunos',          label:'Alunos',         icon:'🎽'},
  {key:'financeiro',      label:'Financeiro',     icon:'💰'},
  {key:'funcionarios',    label:'Funcionários',   icon:'👷'},
  {key:'bar',             label:'Bar / Estoque',  icon:'📦'},
  {key:'unimidia',        label:'Mkt / Divulgar', icon:'📺'},
  {key:'whatsapp',        label:'WhatsApp',       icon:'💬'},
];

function CRMUserProfiles({crmUser,showToast}){
  const [users,setUsers]=useState([]);
  const [perms,setPerms]=useState({});   // {userId: {feature:bool}}
  const [saving,setSaving]=useState({});
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');

  useEffect(()=>{
    fetch('/api/crm-users',{headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}})
      .then(r=>r.json())
      .then(data=>{
        // exclude managers and admins from this view
        const filtered=data.filter(u=>!['admin','manager'].includes(u.role));
        setUsers(filtered);
        const p={};
        filtered.forEach(u=>{
          // if user has custom permissions use them, else use role defaults
          p[u.id]=u.permissions?{...u.permissions}:{...(ROLE_DFLT[u.role]||{})};
        });
        setPerms(p);
        setLoading(false);
      })
      .catch(()=>{showToast('Erro ao carregar usuários','error');setLoading(false);});
  },[]);

  const toggle=(userId,feature)=>{
    setPerms(prev=>{
      const cur=prev[userId]||{};
      return{...prev,[userId]:{...cur,[feature]:!cur[feature]}};
    });
  };

  const resetToDefault=(userId,role)=>{
    setPerms(prev=>({...prev,[userId]:{...(ROLE_DFLT[role]||{})}}));
  };

  const save=(userId)=>{
    setSaving(p=>({...p,[userId]:true}));
    fetch(`/api/crm-users/${userId}/permissions`,{
      method:'PUT',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('token')}`},
      body:JSON.stringify({permissions:perms[userId]||{}})
    })
    .then(r=>{if(!r.ok)throw new Error();return r.json();})
    .then(()=>showToast('Perfil salvo!','success'))
    .catch(()=>showToast('Erro ao salvar','error'))
    .finally(()=>setSaving(p=>({...p,[userId]:false})));
  };

  const filtered=users.filter(u=>!search||u.name.toLowerCase().includes(search.toLowerCase())||u.email.toLowerCase().includes(search.toLowerCase()));

  if(loading)return<div className="p-8 text-center text-gray-400">Carregando...</div>;

  return(
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Perfis de Usuário</h2>
          <p className="text-sm text-gray-500 mt-1">Defina o que cada usuário pode acessar. Os defaults vêm do perfil (role), mas podem ser customizados individualmente.</p>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filtrar usuário..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 w-full sm:w-56"/>
      </div>

      {filtered.length===0&&<div className="text-center text-gray-400 py-16">{search?'Nenhum usuário encontrado.':'Nenhum usuário cadastrado.'}</div>}

      {filtered.map(u=>{
        const p=perms[u.id]||ROLE_DFLT[u.role]||{};
        const dflt=ROLE_DFLT[u.role]||{};
        const hasChanges=PERFIL_FEATURES.some(f=>p[f.key]!==dflt[f.key]);
        return(
          <div key={u.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm">{u.name.charAt(0).toUpperCase()}</div>
                <div>
                  <p className="font-semibold text-gray-800 text-sm">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  u.role==='professor'?'bg-emerald-100 text-emerald-700':
                  u.role==='recepcao'?'bg-yellow-100 text-yellow-700':
                  u.role==='profissional'?'bg-purple-100 text-purple-700':
                  'bg-blue-100 text-blue-700'}`}>{ROLE_NAME[u.role]||u.role}</span>
                {!u.ativo&&<span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">Suspenso</span>}
                {hasChanges&&<span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">✏️ Personalizado</span>}
              </div>
              <div className="flex gap-2">
                {hasChanges&&<button onClick={()=>resetToDefault(u.id,u.role)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">↩ Restaurar</button>}
                <button onClick={()=>save(u.id)} disabled={!!saving[u.id]}
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                  {saving[u.id]?'Salvando...':'💾 Salvar'}</button>
              </div>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {PERFIL_FEATURES.map(feat=>{
                  const enabled=!!p[feat.key];
                  const isDefault=enabled===!!dflt[feat.key];
                  return(
                    <label key={feat.key}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all ${
                        enabled
                          ?isDefault?'border-emerald-200 bg-emerald-50':'border-blue-300 bg-blue-50 shadow-sm'
                          :isDefault?'border-gray-200 bg-gray-50 opacity-50':'border-red-200 bg-red-50 opacity-60'
                      }`}>
                      <input type="checkbox" checked={enabled} onChange={()=>toggle(u.id,feat.key)}
                        className="w-4 h-4 rounded accent-emerald-600 shrink-0"/>
                      <div className="min-w-0">
                        <div className="text-base leading-none">{feat.icon}</div>
                        <div className="text-xs font-medium text-gray-700 mt-1 leading-tight">{feat.label}</div>
                        {!isDefault&&<div className="text-xs text-blue-500 mt-0.5">{enabled?'+ extra':'– removido'}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITLEMENTS — gerência de módulos por estabelecimento (admin only)
// ─────────────────────────────────────────────────────────────────────────────
const ENT_FEATURES=[
  {key:'reservas',        label:'Reservas de Quadra',    icon:'📅'},
  {key:'horarios_livres', label:'Horários Livres',       icon:'🟢'},
  {key:'alunos',          label:'Alunos / Clientes',     icon:'🎽'},
  {key:'financeiro',      label:'Financeiro',            icon:'💰'},
  {key:'funcionarios',    label:'Funcionários',          icon:'👷'},
  {key:'bar',             label:'Estoque Bar',           icon:'📦'},
  {key:'unimidia',        label:'Quero Divulgar',        icon:'📺'},
  {key:'whatsapp',        label:'WhatsApp',              icon:'💬'},
];

function CRMEntitlements({showToast}){
  const [ests,setEsts]=useState([]);
  const [feats,setFeats]=useState({});  // {estId: {key: bool}}
  const [saving,setSaving]=useState({});
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    fetch('/api/establishments/admin/features',{headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}})
      .then(r=>r.json())
      .then(data=>{
        setEsts(data);
        const f={};
        data.forEach(e=>{f[e.id]=e.features||{};});
        setFeats(f);
        setLoading(false);
      })
      .catch(()=>{showToast('Erro ao carregar entitlements','error');setLoading(false);});
  },[]);

  const toggle=(estId,key)=>{
    setFeats(prev=>{
      const cur=prev[estId]||{};
      const enabled=cur[key]!==false;
      return {...prev,[estId]:{...cur,[key]:!enabled}};
    });
  };

  const save=(estId)=>{
    setSaving(p=>({...p,[estId]:true}));
    fetch(`/api/establishments/${estId}/features`,{
      method:'PUT',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('token')}`},
      body:JSON.stringify({features:feats[estId]||{}})
    })
    .then(r=>{if(!r.ok)throw new Error();return r.json();})
    .then(()=>showToast('Entitlements salvos!','success'))
    .catch(()=>showToast('Erro ao salvar','error'))
    .finally(()=>setSaving(p=>({...p,[estId]:false})));
  };

  if(loading)return<div className="p-8 text-center text-gray-400">Carregando...</div>;

  return(
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-gray-800">Entitlements por Estabelecimento</h2>
        <p className="text-sm text-gray-500 mt-1">Controle quais módulos cada estabelecimento tem acesso. Módulos sem marcação ficam ocultos para os usuários do estabelecimento. Por padrão, todos estão habilitados.</p>
      </div>
      {ests.length===0&&<div className="text-center text-gray-400 py-16">Nenhum estabelecimento encontrado.</div>}
      {ests.map(est=>{
        const f=feats[est.id]||{};
        return(
          <div key={est.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-800">{est.name}</h3>
                <p className="text-xs text-gray-400">{est.city}, {est.state}</p>
              </div>
              <button
                onClick={()=>save(est.id)}
                disabled={!!saving[est.id]}
                className="shrink-0 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >{saving[est.id]?'Salvando...':'💾 Salvar'}</button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {ENT_FEATURES.map(feat=>{
                  const enabled=f[feat.key]!==false;
                  return(
                    <label key={feat.key}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all ${enabled?'border-emerald-200 bg-emerald-50 shadow-sm':'border-gray-200 bg-gray-50 opacity-55'}`}
                    >
                      <input type="checkbox" checked={enabled} onChange={()=>toggle(est.id,feat.key)}
                        className="w-4 h-4 rounded accent-emerald-600 shrink-0"/>
                      <div className="min-w-0">
                        <div className="text-lg leading-none">{feat.icon}</div>
                        <div className="text-xs font-medium text-gray-700 mt-1 leading-tight">{feat.label}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function App(){
  const [view,setView]=useState('marketplace');
  const [page,setPage]=useState('mkt-home');
  const [pageArg,setPageArg]=useState(null);
  const [crmUser,setCrmUser]=useState(null);
  const [publicUser,setPublicUser]=useState(null);
  const [establishments,setEstablishments]=useState([]);
  const [points,setPoints]=useState([]);
  const [profissionais,setProfissionais]=useState([]);
  const [toast,setToast]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  const [authMode,setAuthMode]=useState('login');
  const [pendRes,setPendRes]=useState(null);
  const [confRes,setConfRes]=useState(null);
  const [confLoading,setConfLoading]=useState(false);
  const [resetToken,setResetToken]=useState(null);
  const [resetType,setResetType]=useState('public');
  const [isImpersonating,setIsImpersonating]=useState(false);

  const showToast=useCallback((message,type='success')=>{
    setToast({message,type});
    setTimeout(()=>setToast(null),3500);
  },[]);

  const navigate=(pg,arg=null)=>{
    setPage(pg);setPageArg(arg);window.scrollTo(0,0);
    if(pg==='crm-login'||pg.startsWith('crm-')||pg==='prof-perfil'||pg==='prof-alunos')setView('crm');
    else if(pg==='password-recovery')setView('password-recovery');
    else if(pg==='reset-password')setView('reset-password');
    else setView('marketplace');
    if(pg==='est-detail'&&arg) window.history.pushState({pg,arg},'',`/e/${arg}`);
    else if(pg==='prof-detail'&&arg) window.history.pushState({pg,arg},'',`/p/${arg}`);
    else if(!pg.startsWith('crm-')&&!pg.startsWith('prof-')&&pg!=='password-recovery'&&pg!=='reset-password')
      window.history.replaceState({pg,arg},'','/');
  };

  useEffect(()=>{
    const handler=(e)=>{
      const s=e.state;
      if(s?.pg==='est-detail'&&s?.arg){setPage('est-detail');setPageArg(s.arg);setView('marketplace');}
      else if(s?.pg==='prof-detail'&&s?.arg){setPage('prof-detail');setPageArg(s.arg);setView('marketplace');}
      else{setPage('mkt-home');setPageArg(null);setView('marketplace');}
      window.scrollTo(0,0);
    };
    window.addEventListener('popstate',handler);
    return()=>window.removeEventListener('popstate',handler);
  },[]);

  // Detecta sessão expirada (401) e força logout automático
  useEffect(()=>{
    const handleExpired=()=>{
      setCrmUser(null);setIsImpersonating(false);setPublicUser(null);
      setPage('crm-login');setView('crm');
      setTimeout(()=>showToast('Sessão expirada. Faça login novamente.','error'),100);
    };
    window.addEventListener('crm:session-expired',handleExpired);
    return()=>window.removeEventListener('crm:session-expired',handleExpired);
  },[showToast]);

  const loadMkt=useCallback(()=>{
    estApi.list().then(setEstablishments).catch(()=>{});
    pointApi.list().then(setPoints).catch(()=>{});
    profEfApi.publicList().then(setProfissionais).catch(()=>{});
  },[]);
  useEffect(()=>{loadMkt();},[loadMkt]);

  useEffect(()=>{
    const token=localStorage.getItem('token');
    const savedUser=localStorage.getItem('user');
    const savedType=localStorage.getItem('userType');
    if(token&&savedUser){
      try{
        const u=JSON.parse(savedUser);
        if(savedType==='crm'){
          setCrmUser(u);setView('crm');
          if(localStorage.getItem('token_admin_backup'))setIsImpersonating(true);
        } else setPublicUser(u);
      }catch{}
    }
    const params=new URLSearchParams(window.location.search);
    const urlToken=params.get('token');
    const urlType=params.get('type')||'public';
    if(urlToken){
      setResetToken(urlToken);setResetType(urlType);setView('reset-password');
      window.history.replaceState({},'',window.location.pathname);
      return;
    }
    const path=window.location.pathname;
    const estMatch=path.match(/^\/e\/(\d+)$/);
    if(estMatch){setPage('est-detail');setPageArg(Number(estMatch[1]));setView('marketplace');window.history.replaceState({pg:'est-detail',arg:Number(estMatch[1])},'',path);return;}
    const profMatch=path.match(/^\/p\/(\d+)$/);
    if(profMatch){setPage('prof-detail');setPageArg(Number(profMatch[1]));setView('marketplace');window.history.replaceState({pg:'prof-detail',arg:Number(profMatch[1])},'',path);}
  },[]);

  const crmLogin=async(email,pw)=>{
    const{token,user}=await authApi.crmLogin(email,pw);
    if(localStorage.getItem('userType')==='public'){
      localStorage.setItem('public_token_backup',localStorage.getItem('token'));
      localStorage.setItem('public_user_backup',localStorage.getItem('user'));
    }
    saveToken(token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('userType','crm');
    setCrmUser(user);
    if(user.role==='profissional') navigate('prof-perfil');
    else navigate(['simples','recepcao'].includes(user.role)?'crm-reservations':user.role==='professor'?'crm-alunos':'crm-dashboard');
  };
  const crmLogout=()=>{
    const pubTok=localStorage.getItem('public_token_backup');
    const pubUsr=localStorage.getItem('public_user_backup');
    clearToken();localStorage.removeItem('user');localStorage.removeItem('userType');
    localStorage.removeItem('token_admin_backup');localStorage.removeItem('user_admin_backup');
    localStorage.removeItem('public_token_backup');localStorage.removeItem('public_user_backup');
    setCrmUser(null);setIsImpersonating(false);
    if(pubTok&&pubUsr){
      saveToken(pubTok);localStorage.setItem('user',pubUsr);localStorage.setItem('userType','public');
      try{setPublicUser(JSON.parse(pubUsr));}catch{}
    } else {
      setPublicUser(null);
    }
    navigate('mkt-home');
  };
  const handleImpersonate=async(userId)=>{
    try{
      const{token,user}=await impersonateApi.impersonate(userId);
      localStorage.setItem('token_admin_backup',localStorage.getItem('token'));
      localStorage.setItem('user_admin_backup',localStorage.getItem('user'));
      saveToken(token);localStorage.setItem('user',JSON.stringify(user));
      setCrmUser(user);setIsImpersonating(true);
      navigate('crm-dashboard');
      showToast(`Visualizando como ${user.name}`,'success');
    }catch(e){showToast(e.message||'Erro ao trocar usuário','error');}
  };
  const handleStopImpersonating=()=>{
    const backupToken=localStorage.getItem('token_admin_backup');
    const backupUser=localStorage.getItem('user_admin_backup');
    if(backupToken&&backupUser){
      saveToken(backupToken);
      const u=JSON.parse(backupUser);
      localStorage.setItem('user',JSON.stringify(u));
      setCrmUser(u);
    }
    localStorage.removeItem('token_admin_backup');localStorage.removeItem('user_admin_backup');
    setIsImpersonating(false);navigate('crm-dashboard');
    showToast('Voltou ao modo Administrador');
  };
  const pubLogin=async(email,pw)=>{
    const{token,user}=await authApi.pubLogin(email,pw);
    saveToken(token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('userType','public');
    setPublicUser(user);setShowAuth(false);
    if(pendRes){setConfRes(pendRes);setPendRes(null);}
  };
  const pubRegister=async(name,cpf,email,pw)=>{
    const{token,user}=await authApi.pubRegister(name,cpf,email,pw);
    saveToken(token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('userType','public');
    setPublicUser(user);setShowAuth(false);
    if(pendRes){setConfRes(pendRes);setPendRes(null);}
  };
  const pubLogout=()=>{
    clearToken();localStorage.removeItem('user');localStorage.removeItem('userType');
    setPublicUser(null);
  };

  const handleReserve=(res)=>{
    if(!publicUser){setPendRes(res);setShowAuth(true);return;}
    setConfRes(res);
  };
  const confirmReserve=async()=>{
    if(!confRes||confLoading)return;
    setConfLoading(true);
    try{
      const{pt,est,date,startT,endT,hours,total}=confRes;
      await resApi.create({point_id:pt.id,est_id:est?.id||pt.est_id,date,start_time:startT,end_time:endT,hours,total});
      showToast('Reserva solicitada! Aguarde confirmação.','success');
      setConfRes(null);loadMkt();
    }catch(e){showToast(e.message||'Erro ao reservar','error');}
    finally{setConfLoading(false);}
  };

  const crmRoutes={
    'crm-dashboard':    <CRMDashboard/>,
    'crm-establishment':<CRMEstablishment crmUser={crmUser} showToast={showToast}/>,
    'crm-points':       <CRMPoints crmUser={crmUser} showToast={showToast}/>,
    'crm-users':        <CRMUsers crmUser={crmUser} showToast={showToast}/>,
    'crm-reservations': <CRMReservations crmUser={crmUser} showToast={showToast}/>,
    'crm-professors':   <CRMProfessors crmUser={crmUser} showToast={showToast}/>,
    'crm-profissionais-ef':<CRMProfissionaisEF showToast={showToast}/>,
    'crm-alunos':       <CRMAlunos crmUser={crmUser} showToast={showToast}/>,
    'crm-unimidia':     <CRMUnimidia crmUser={crmUser} showToast={showToast}/>,
    'crm-funcionarios': <CRMFuncionarios crmUser={crmUser} showToast={showToast}/>,
    'crm-financeiro':   <CRMFinanceiro crmUser={crmUser} showToast={showToast}/>,
    'crm-horarios-livres': <CRMHorariosLivres crmUser={crmUser} showToast={showToast}/>,
    'crm-estoque':      <CRMEstoque crmUser={crmUser} showToast={showToast}/>,
    'crm-audit':        <CRMAudit showToast={showToast}/>,
    'crm-whatsapp':     <CRMWhatsApp crmUser={crmUser} showToast={showToast}/>,
    'crm-entitlements': <CRMEntitlements showToast={showToast}/>,
    'crm-user-profiles': <CRMUserProfiles crmUser={crmUser} showToast={showToast}/>,
    'prof-perfil':      <CRMProfissionalHome crmUser={crmUser} showToast={showToast}/>,
    'prof-alunos':      <CRMPlanosAula showToast={showToast}/>,
  };

  if(view==='reset-password')return<ResetPassword token={resetToken} type={resetType} navigate={navigate} showToast={showToast}/>;
  if(view==='password-recovery')return<PasswordRecovery navigate={navigate} type={pageArg||'public'}/>;

  if(view==='crm'){
    if(!crmUser)return<CRMLogin onLogin={crmLogin} navigate={navigate}/>;
    return<>
      <Toast toast={toast}/>
      <CRMLayout crmUser={crmUser} page={page} navigate={navigate} onLogout={crmLogout}
        isImpersonating={isImpersonating}
        onStopImpersonating={handleStopImpersonating}
        onImpersonate={handleImpersonate}>
        {crmRoutes[page]||<CRMDashboard/>}
      </CRMLayout>
    </>;
  }

  return<>
    <Toast toast={toast}/>
    <MktHeader publicUser={publicUser} page={page} navigate={navigate} onLogout={pubLogout}/>
    {page==='mkt-home'&&<MktHome establishments={establishments} points={points} profissionais={profissionais} navigate={navigate}/>}
    {page==='est-detail'&&<><EstDetail estId={pageArg} points={points} navigate={navigate} publicUser={publicUser} onReserve={handleReserve}/><div className="max-w-7xl mx-auto px-4 pb-10"><ReviewsBlock targetType="establishment" targetId={pageArg} publicUser={publicUser} showToast={showToast}/></div></>}
    {page==='prof-detail'&&<><ProfDetail profId={pageArg} navigate={navigate}/><div className="max-w-2xl mx-auto px-4 pb-10"><ReviewsBlock targetType="profissional" targetId={pageArg} publicUser={publicUser} showToast={showToast}/></div></>}
    {page==='my-reservations'&&<MyReservations publicUser={publicUser} navigate={navigate} showToast={showToast}/>}
    {page==='public-auth'&&<AuthModal open={showAuth||true} onClose={()=>navigate('mkt-home')} onLogin={pubLogin} onRegister={pubRegister} initialMode={pageArg||'login'}/>}
    <AuthModal open={showAuth} onClose={()=>{setShowAuth(false);setPendRes(null);}} onLogin={pubLogin} onRegister={pubRegister} initialMode={authMode}/>
    <Modal open={!!confRes} onClose={()=>setConfRes(null)} title="Confirmar Reserva">
      {confRes&&<div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
          <p className="font-semibold text-gray-800">{confRes.pt.name}</p>
          <p className="text-gray-500">Data: {fmtDate(confRes.date)}</p>
          <p className="text-gray-500">Horário: {confRes.startT} – {confRes.endT}</p>
          <p className="font-bold text-emerald-700 pt-1">Total: {fmt$(confRes.total)}</p>
        </div>
        <div className="flex gap-3">
          <Btn variant="secondary" className="flex-1" onClick={()=>setConfRes(null)}>Cancelar</Btn>
          <Btn className="flex-1" onClick={confirmReserve} disabled={confLoading}>{confLoading?'Aguarde...':'Confirmar Reserva'}</Btn>
        </div>
      </div>}
    </Modal>
  </>;
}