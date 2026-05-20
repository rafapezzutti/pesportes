import React, { useState, useEffect, useCallback } from 'react';
import {
  authApi, estApi, pointApi, userApi, resApi, dashboardApi,
  saveToken, clearToken,
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

// ================================================================
// UTILITIES
// ================================================================
const fmt$ = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v);
const fmtDate = d => { if(!d)return''; const s=typeof d==='string'?d:d.toISOString().split('T')[0]; const[y,m,dd]=s.split('-'); return`${dd}/${m}/${y}`; };
const statusLabel = s => ({confirmed:'Confirmada',cancelled:'Cancelada',completed:'Concluída'}[s]||s);
const statusColor = s => ({confirmed:'bg-emerald-100 text-emerald-700',cancelled:'bg-red-100 text-red-700',completed:'bg-gray-100 text-gray-600'}[s]||'bg-gray-100 text-gray-600');
const canModify = r => { const dt=new Date(`${typeof r.date==='string'?r.date:r.date.toISOString().split('T')[0]}T${r.start_time}:00`); return new Date()<new Date(dt.getTime()-2*60*60*1000); };

async function viaCEP(cep) {
  const c=cep.replace(/\D/g,'');
  if(c.length!==8)return null;
  try{const r=await fetch(`https://viacep.com.br/ws/${c}/json/`);const d=await r.json();return d.erro?null:d;}catch{return null;}
}

function resizeImage(file,maxW=1200,quality=0.82){
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
  const vr={primary:'bg-emerald-600 hover:bg-emerald-700 text-white focus:ring-emerald-500',secondary:'bg-white border border-gray-300 hover:bg-gray-50 text-gray-700',danger:'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',ghost:'bg-transparent hover:bg-gray-100 text-gray-600',outline:'border border-emerald-600 text-emerald-600 hover:bg-emerald-50'};
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
function MktHome({establishments,points,navigate}){
  const [search,setSearch]=useState('');
  const [typeF,setTypeF]=useState('');
  const filtered=establishments.filter(e=>{
    const mT=!typeF||points.some(p=>p.est_id===e.id&&p.type===typeF);
    const s=search.toLowerCase();
    const mS=!s||e.name.toLowerCase().includes(s)||(e.street||'').toLowerCase().includes(s)||(e.city||'').toLowerCase().includes(s);
    return mT&&mS;
  });
  return<div><div className="bg-gradient-to-br from-emerald-800 via-emerald-700 to-emerald-600 text-white"><div className="max-w-4xl mx-auto px-4 pt-16 pb-20 text-center"><h1 className="text-4xl sm:text-5xl font-black mb-3 tracking-tight">Reserve seu esporte favorito</h1><p className="text-emerald-200 text-lg mb-10">Quadras, campos e espaços esportivos perto de você</p><div className="bg-white rounded-2xl p-4 shadow-2xl"><div className="flex flex-col sm:flex-row gap-3"><div className="flex-1"><Sel value={typeF} onChange={e=>setTypeF(e.target.value)} options={ESTABLISHMENT_TYPES} placeholder="Tipo de esporte / espaço"/></div><div className="flex-1"><Inp value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome do local ou endereço..."/></div></div></div></div></div><div className="max-w-7xl mx-auto px-4 py-10"><div className="flex items-center justify-between mb-6"><h2 className="text-xl font-semibold text-gray-800">{filtered.length} estabelecimento{filtered.length!==1?'s':''} encontrado{filtered.length!==1?'s':''}</h2>{(search||typeF)&&<button onClick={()=>{setSearch('');setTypeF('');}} className="text-sm text-emerald-600 hover:underline">Limpar filtros</button>}</div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">{filtered.map(est=>{const pts=points.filter(p=>p.est_id===est.id);const minP=pts.length?Math.min(...pts.map(p=>p.price_per_hour)):0;const types=[...new Set(pts.map(p=>p.type))];return<div key={est.id} onClick={()=>navigate('est-detail',est.id)} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 card-hover cursor-pointer"><div className="h-48 relative overflow-hidden bg-gray-200">{est.main_photo?<img src={est.main_photo} alt={est.name} className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center text-5xl">🏟️</div>}<div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3"><p className="text-white text-xs font-medium">{est.street}{est.number?`, ${est.number}`:''}</p></div></div><div className="p-4"><h3 className="font-bold text-gray-800 mb-1">{est.name}</h3><p className="text-xs text-gray-500 mb-3">{pts.length} espaço{pts.length!==1?'s':''} • {est.city||''}/{est.state||''}</p><div className="flex items-end justify-between"><div className="flex flex-wrap gap-1">{types.slice(0,2).map(t=><Badge key={t} color="green">{t.replace('Quadra de ','')}</Badge>)}{types.length>2&&<Badge color="gray">+{types.length-2}</Badge>}</div><div className="text-right"><p className="text-xs text-gray-400">a partir de</p><p className="text-emerald-600 font-bold text-sm">{fmt$(minP)}/h</p></div></div></div></div>;})}</div>{filtered.length===0&&<div className="text-center py-20"><p className="text-6xl mb-4">🔍</p><p className="text-xl text-gray-500 mb-2">Nenhum estabelecimento encontrado</p></div>}</div></div>;
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

  return<div className="max-w-7xl mx-auto px-4 py-8"><button onClick={()=>navigate('mkt-home')} className="text-emerald-600 hover:text-emerald-700 text-sm mb-5 flex items-center gap-1.5 font-medium">← Voltar</button><div className="grid grid-cols-1 lg:grid-cols-3 gap-8"><div className="lg:col-span-2 space-y-6"><div className="relative rounded-2xl overflow-hidden h-72 bg-gray-200">{photos.length?<img src={photos[photo]} alt={est.name} className="w-full h-full object-cover"/>:<div className="w-full h-full flex items-center justify-center text-7xl">🏟️</div>}{photos.length>1&&<><button onClick={()=>setPhoto(p=>(p-1+photos.length)%photos.length)} className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center">‹</button><button onClick={()=>setPhoto(p=>(p+1)%photos.length)} className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full flex items-center justify-center">›</button><div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">{photos.map((_,i)=><button key={i} onClick={()=>setPhoto(i)} className={`w-2 h-2 rounded-full ${i===photo?'bg-white':'bg-white/40'}`}/>)}</div></>}</div><div><h1 className="text-2xl font-black text-gray-900 mb-2">{est.name}</h1><p className="text-gray-500 text-sm mb-1">📍 {est.street}{est.number?`, ${est.number}`:''}{est.complement?` — ${est.complement}`:''}</p><p className="text-gray-500 text-sm mb-1">{est.city}/{est.state} — CEP {est.cep}</p><p className="text-gray-500 text-sm">📞 {est.phone}</p></div><div className="bg-white rounded-2xl border border-gray-100 p-5"><h3 className="font-bold text-gray-800 mb-3">Horário de Funcionamento</h3><div className="grid grid-cols-2 gap-1">{DAYS.map(({key,label})=><div key={key} className="flex items-center gap-2 text-sm py-0.5"><span className="w-9 text-gray-500 font-medium">{label}:</span>{est.operating_hours?.[key]?.open?<span className="text-gray-700">{est.operating_hours[key].start} – {est.operating_hours[key].end}</span>:<span className="text-gray-400 italic text-xs">Fechado</span>}</div>)}</div></div><div><h3 className="font-bold text-gray-800 mb-3">Espaços disponíveis</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{pts.map(pt=><div key={pt.id} onClick={()=>{setSelPt(pt);setSelSlots([]);}} className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${selPt?.id===pt.id?'border-emerald-500 bg-emerald-50':'border-gray-200 hover:border-emerald-300 bg-white'}`}><div className="flex justify-between items-start"><div><p className="font-semibold text-gray-800">{pt.name}</p><p className="text-xs text-gray-500 mt-0.5">{pt.type}</p></div><span className="text-emerald-600 font-bold text-sm">{fmt$(pt.price_per_hour)}/h</span></div>{pt.custom_hours&&<p className="text-xs text-amber-600 mt-1.5">⏰ Horário próprio</p>}</div>)}</div></div></div><div className="lg:col-span-1"><div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm sticky top-24"><h3 className="font-bold text-gray-800 mb-4 text-base">Fazer uma Reserva</h3>{!selPt?<div className="text-center py-8"><p className="text-4xl mb-2">👈</p><p className="text-sm text-gray-400">Selecione um espaço ao lado</p></div>:<div className="space-y-4"><div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100"><p className="text-sm font-semibold text-emerald-800">{selPt.name}</p><p className="text-xs text-emerald-600">{selPt.type} • {fmt$(selPt.price_per_hour)}/hora</p></div><Field label="Data da reserva" required><Inp type="date" value={selDate} min={TODAY} max={maxDateStr} onChange={e=>{setSelDate(e.target.value);setSelSlots([]);}}/></Field>{selDate&&<div><p className="text-sm font-medium text-gray-700 mb-2">Horários disponíveis</p>{slotsLoading?<Spinner text="Buscando horários..."/>:slots.length===0?<div className="text-center py-4 bg-gray-50 rounded-lg"><p className="text-sm text-gray-400">Nenhum horário disponível</p></div>:<><div className="grid grid-cols-3 gap-1.5">{slots.map(s=><button key={s.time} onClick={()=>toggleSlot(s)} disabled={!s.available} className={`slot-btn py-2 text-xs rounded-lg border font-medium ${selSlots.includes(s.time)?'bg-emerald-600 text-white border-emerald-600':s.available?'border-gray-300 hover:border-emerald-400 text-gray-700':'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed line-through'}`}>{s.time}</button>)}</div><p className="text-xs text-gray-400 mt-1.5">Selecione horários consecutivos</p></>}</div>}{selSlots.length>0&&<div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-sm"><div className="flex justify-between text-gray-600"><span>Período</span><span className="font-medium">{startT} – {endT}</span></div><div className="flex justify-between text-gray-600"><span>Duração</span><span className="font-medium">{hours}h</span></div><div className="flex justify-between text-emerald-700 font-bold pt-1.5 border-t border-gray-200"><span>Total estimado</span><span>{fmt$(total)}</span></div><p className="text-xs text-gray-400">💳 Pagamento no local</p></div>}<Btn onClick={handleRes} disabled={!canRes} className="w-full" size="lg">{publicUser?'Solicitar Reserva':'Entrar para Reservar'}</Btn></div>}</div></div></div></div>;
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
  const upcoming=reservations.filter(r=>r.status==='confirmed'&&new Date(`${typeof r.date==='string'?r.date:r.date.toISOString().split('T')[0]}T${r.end_time}:00`)>now);
  const past=reservations.filter(r=>r.status!=='confirmed'||new Date(`${typeof r.date==='string'?r.date:r.date.toISOString().split('T')[0]}T${r.end_time}:00`)<=now);

  const handleCancel=async(id)=>{
    try{await resApi.cancel(id);showToast('Reserva cancelada. Email enviado.','info');load();}
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
function PasswordRecovery({navigate}){
  const [step,setStep]=useState(1);
  const [email,setEmail]=useState('');
  const [loading,setLoading]=useState(false);
  const send=async()=>{
    setLoading(true);
    try{await authApi.forgotPassword(email,'public');setStep(2);}catch{setStep(2);}finally{setLoading(false);}
  };
  return<div className="min-h-screen bg-gray-100 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm"><div className="text-center mb-6"><div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">🔑</span></div><h1 className="text-xl font-bold text-gray-800">Recuperar Senha</h1></div>{step===1?<div className="space-y-4"><p className="text-sm text-gray-500 text-center">Informe seu email cadastrado.</p><Field label="Email"><Inp type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field><Btn className="w-full" onClick={send} disabled={!email||loading}>{loading?'Enviando...':'Enviar Link'}</Btn></div>:<div className="text-center space-y-3"><p className="text-5xl">📬</p><p className="text-sm text-gray-700 font-medium">Email enviado!</p><p className="text-xs text-gray-500">Link enviado para <strong>{email}</strong>. Expira em 30 minutos.</p></div>}<button onClick={()=>navigate('mkt-home')} className="text-sm text-emerald-600 hover:underline mt-5 block text-center w-full">← Voltar ao início</button></div></div>;
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
  return<div className="min-h-screen bg-gray-900 flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm"><div className="text-center mb-7"><div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg"><span className="text-white font-black text-2xl">P</span></div><h1 className="text-xl font-black text-gray-800">P. Soluções</h1><p className="text-sm text-gray-400">Sistema de Gestão — CRM</p></div><div className="space-y-3"><Field label="Email"><Inp type="email" value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Senha"><Inp type="password" value={pw} onChange={e=>setPw(e.target.value)}/></Field>{err&&<p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{err}</p>}<Btn className="w-full" size="lg" onClick={handle} disabled={loading}>{loading?'Entrando...':'Entrar no CRM'}</Btn><button onClick={()=>navigate('password-recovery')} className="text-xs text-emerald-600 hover:underline w-full text-center">Esqueci minha senha</button></div><div className="text-center mt-4"><button onClick={()=>navigate('mkt-home')} className="text-xs text-gray-400 hover:text-gray-600">← Voltar ao Marketplace</button></div></div></div>;
}

// ================================================================
// CRM LAYOUT
// ================================================================
function CRMLayout({crmUser,page,navigate,onLogout,children}){
  const menu=[
    {key:'crm-dashboard',    label:'Dashboard',      icon:'📊',roles:['admin','manager']},
    {key:'crm-reservations', label:'Reservas',       icon:'📅',roles:['admin','manager','simples']},
    {key:'crm-establishment',label:'Estabelecimentos',icon:'🏢',roles:['admin','manager']},
    {key:'crm-points',       label:'Pontos',         icon:'📍',roles:['admin','manager']},
    {key:'crm-users',        label:'Usuários',       icon:'👥',roles:['admin','manager']},
  ].filter(m=>m.roles.includes(crmUser.role));
  const roleLabel={admin:'Administrador',manager:'Gerente',simples:'Usuário Simples'};
  return<div className="min-h-screen bg-gray-100 flex"><aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0"><div className="p-4 border-b border-gray-100"><div className="flex items-center gap-2.5"><div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl flex items-center justify-center"><span className="text-white font-black">P</span></div><div><p className="text-xs font-black text-gray-800 leading-tight">P. Soluções</p><p className="text-xs text-gray-400 leading-tight">CRM</p></div></div></div><nav className="flex-1 p-3 space-y-0.5">{menu.map(m=><button key={m.key} onClick={()=>navigate(m.key)} className={`sidebar-item w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium ${page===m.key?'bg-emerald-50 text-emerald-700':'text-gray-600 hover:bg-gray-50'}`}><span className="text-base">{m.icon}</span>{m.label}</button>)}</nav><div className="p-3 border-t border-gray-100 space-y-2"><div className="px-3 py-2"><p className="text-xs font-semibold text-gray-700 truncate">{crmUser.name}</p><p className="text-xs text-gray-400">{roleLabel[crmUser.role]||crmUser.role}</p></div><Btn variant="ghost" size="sm" onClick={onLogout} className="w-full text-gray-500">Sair do CRM</Btn></div></aside><main className="flex-1 overflow-auto">{children}</main></div>;
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

  useEffect(()=>{
    dashboardApi.get().then(setData).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  if(loading)return<Spinner/>;

  const month=TODAY.slice(0,7).split('-');
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

  return<div className="p-6 max-w-5xl"><h1 className="text-2xl font-black text-gray-900 mb-2">Dashboard</h1><p className="text-sm text-gray-400 mb-6">{fmtDate(TODAY)}</p>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">{[
      {label:'Reservas hoje',value:todayCount,icon:'📅',color:'bg-emerald-50'},
      {label:'Faturamento hoje',value:fmt$(todayTotal),icon:'💰',color:'bg-blue-50'},
      {label:`Reservas em ${monthLabel}`,value:monthCount,icon:'📆',color:'bg-amber-50'},
      {label:`Faturamento ${monthLabel}`,value:fmt$(monthTotal),icon:'📈',color:'bg-purple-50'},
    ].map(c=><div key={c.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm"><div className="flex items-start gap-3"><div className={`w-10 h-10 ${c.color} rounded-xl flex items-center justify-center text-xl shrink-0`}>{c.icon}</div><div className="min-w-0"><p className="text-xs text-gray-400 mb-0.5 leading-tight">{c.label}</p><p className="text-lg font-black text-gray-800 truncate">{c.value}</p></div></div></div>)}</div>

    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-5 pt-4"><nav className="flex gap-1">{[
        {key:'today',label:`Hoje — ${fmtDate(TODAY)}`},
        {key:'month',label:`Mês — ${monthLabel}`},
        {key:'pay',  label:'Por Pagamento'},
      ].map(t=><button key={t.key} onClick={()=>setTab(t.key)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab===t.key?'border-emerald-600 text-emerald-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label}</button>)}</nav></div>
      <div className="p-5">
        {tab==='today'&&<DashTable rows={data?.today} cols={pointCols} emptyMsg="Nenhuma reserva confirmada hoje"/>}
        {tab==='month'&&<DashTable rows={data?.monthByPoint} cols={pointCols} emptyMsg="Nenhuma reserva no mês"/>}
        {tab==='pay'&&<DashTable rows={data?.monthByPay} cols={payCols} emptyMsg="Nenhuma reserva no mês"/>}
      </div>
    </div>
  </div>;
}

// ================================================================
// CRM ESTABLISHMENT
// ================================================================
function CRMEstablishment({showToast}){
  const BLANK={name:'',responsible:'',cpf_cnpj:'',phone:'',email:'',street:'',number:'',complement:'',cep:'',city:'',state:'',photos:[],main_photo:'',operating_hours:{...DEFAULT_HOURS}};
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
    setForm({...BLANK,name:e.name||'',phone:e.phone||'',street:e.street||'',number:e.number||'',complement:e.complement||'',cep:e.cep||'',city:e.city||'',state:e.state||'',photos:e.photos||[],main_photo:e.main_photo||'',operating_hours:e.operating_hours||{...DEFAULT_HOURS}});
    try{const full=await estApi.getFull(e.id);setForm(f=>({...f,responsible:full.responsible||'',cpf_cnpj:full.cpf_cnpj||'',email:full.email||''}));}catch{}
    setTab('cadastro');
  };

  const handleCEP=async(v)=>{upd('cep',v);if(v.replace(/\D/g,'').length===8){setCepLoading(true);const d=await viaCEP(v);setCepLoading(false);if(d){upd('street',d.logradouro);upd('city',d.localidade);upd('state',d.uf);showToast('Endereço preenchido!','success');}}};
  const addPhotosFromFiles=async(e)=>{
    const files=Array.from(e.target.files);
    if(!files.length)return;
    setUploading(true);
    for(const file of files){
      if(!file.type.startsWith('image/')){showToast(`${file.name}: somente imagens`,'error');continue;}
      if(file.size>8*1024*1024){showToast(`${file.name}: máx. 8MB`,'error');continue;}
      const dataUrl=await resizeImage(file);
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
      if(editId){await estApi.update(editId,form);}else{await estApi.create(form);}
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
      }
    </div>}

    {tab==='cadastro'&&<div>
      {editId&&<p className="text-xs text-emerald-600 font-medium mb-4">✏️ Editando estabelecimento existente — <button className="underline" onClick={openNew}>ou criar novo</button></p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="space-y-5"><div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4"><h2 className="font-bold text-gray-700">Dados Gerais</h2><Field label="Nome do Local" badge="pub" required><Inp value={form.name} onChange={e=>upd('name',e.target.value)}/></Field><Field label="Responsável" badge="int" required><Inp value={form.responsible} onChange={e=>upd('responsible',e.target.value)}/></Field><Field label="CPF / CNPJ" badge="int"><Inp value={form.cpf_cnpj} onChange={e=>upd('cpf_cnpj',e.target.value)}/></Field><Field label="Telefone" badge="pub" required><Inp value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="(00) 00000-0000"/></Field><Field label="Email" badge="int"><Inp type="email" value={form.email} onChange={e=>upd('email',e.target.value)}/></Field></div><div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3"><h2 className="font-bold text-gray-700">Endereço <span className="text-xs font-normal text-blue-500 ml-1">🌐 Público</span></h2><Field label="CEP" help={cepLoading?'Buscando endereço...':''}><Inp value={form.cep} onChange={e=>handleCEP(e.target.value)} placeholder="00000-000"/></Field><Field label="Rua"><Inp value={form.street} onChange={e=>upd('street',e.target.value)}/></Field><div className="grid grid-cols-2 gap-3"><Field label="Número"><Inp value={form.number} onChange={e=>upd('number',e.target.value)}/></Field><Field label="Complemento"><Inp value={form.complement} onChange={e=>upd('complement',e.target.value)}/></Field></div><div className="grid grid-cols-3 gap-3"><div className="col-span-2"><Field label="Cidade"><Inp value={form.city} onChange={e=>upd('city',e.target.value)}/></Field></div><Field label="UF"><Inp value={form.state} onChange={e=>upd('state',e.target.value.toUpperCase().slice(0,2))} placeholder="SP"/></Field></div></div></div><div className="space-y-5"><div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3"><h2 className="font-bold text-gray-700">Fotos <span className="text-xs font-normal text-blue-500 ml-1">🌐 Público</span></h2><label className={`flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed rounded-xl p-5 cursor-pointer transition-colors ${uploading?'border-emerald-300 bg-emerald-50':'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50'}`}><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={addPhotosFromFiles} disabled={uploading}/><span className="text-3xl">{uploading?'⏳':'📷'}</span><div className="text-center"><p className="text-sm font-medium text-gray-700">{uploading?'Processando...':'Clique para adicionar fotos'}</p><p className="text-xs text-gray-400">JPEG · PNG · WebP · máx. 8MB por foto · múltiplos arquivos</p></div></label>{form.photos.length===0&&<p className="text-xs text-gray-400 text-center py-1">Nenhuma foto adicionada</p>}<div className="grid grid-cols-2 gap-2">{form.photos.map((ph,i)=><div key={i} className={`relative rounded-xl overflow-hidden border-2 ${form.main_photo===ph?'border-emerald-500':'border-transparent'}`}><img src={ph} alt="" className="w-full h-28 object-cover" onError={e=>e.target.style.display='none'}/><div className="absolute bottom-0 left-0 right-0 flex gap-1 p-1.5"><button onClick={()=>upd('main_photo',ph)} className="flex-1 text-xs text-white bg-emerald-600/90 rounded-lg py-1">{form.main_photo===ph?'★ Principal':'★'}</button><button onClick={()=>rmPhoto(ph)} className="text-xs text-white bg-red-600/90 rounded-lg px-2 py-1">✕</button></div></div>)}</div></div><div className="bg-white rounded-2xl border border-gray-100 p-5"><h2 className="font-bold text-gray-700 mb-1">Horário de Funcionamento <span className="text-xs font-normal text-blue-500 ml-1">🌐 Público</span></h2><p className="text-xs text-gray-400 mb-3">Padrão herdado por todos os pontos</p><HoursEditor value={form.operating_hours} onChange={v=>upd('operating_hours',v)}/></div></div></div>
    </div>}
  </div>;
}
// ================================================================
function CRMPoints({crmUser,showToast}){
  const [points,setPoints]=useState([]);
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [estSearch,setEstSearch]=useState('');
  const [showForm,setShowForm]=useState(false);
  const [editPt,setEditPt]=useState(null);
  const [f,setF]=useState({est_id:'',type:'',name:'',price_per_hour:'',custom_hours:null});
  const [customH,setCustomH]=useState(false);
  const [delPt,setDelPt]=useState(null);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const isAdmin=crmUser?.role==='admin';
  const isManager=crmUser?.role==='manager';
  const canEdit=isAdmin||isManager;

  const load=()=>{
    Promise.all([pointApi.list(),estApi.list()]).then(([p,e])=>{setPoints(p);setEsts(e);}).catch(()=>{}).finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);

  const openNew=()=>{setF({est_id:ests[0]?.id||'',type:'',name:'',price_per_hour:'',custom_hours:null});setCustomH(false);setEditPt(null);setShowForm(true);};
  const openEdit=(p)=>{setF({est_id:p.est_id||ests[0]?.id||'',type:p.type,name:p.name,price_per_hour:p.price_per_hour,custom_hours:p.custom_hours});setCustomH(!!p.custom_hours);setEditPt(p);setShowForm(true);};

  const save=async()=>{
    if(!f.est_id||!f.type||!f.name||!f.price_per_hour){showToast('Preencha todos os campos obrigatórios','error');return;}
    const payload={...f,custom_hours:customH?(f.custom_hours||{...DEFAULT_HOURS}):null};
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

  const filteredPts=estSearch?points.filter(pt=>(pt.est_name||'').toLowerCase().includes(estSearch.toLowerCase())):points;
  return<div className="p-6"><div className="flex items-center justify-between mb-6"><h1 className="text-2xl font-black text-gray-900">Pontos / Espaços</h1>{canEdit&&<Btn onClick={openNew}>+ Novo Ponto</Btn>}</div><div className="bg-white rounded-2xl border border-gray-100 p-3 mb-5 flex items-center gap-2"><span className="text-gray-400">🔍</span><input value={estSearch} onChange={e=>setEstSearch(e.target.value)} placeholder="Buscar por estabelecimento..." className="flex-1 text-sm outline-none placeholder-gray-400"/>{estSearch&&<button onClick={()=>setEstSearch('')} className="text-xs text-gray-400 hover:text-gray-600">✕</button>}</div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{filteredPts.map(pt=><div key={pt.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm"><div className="flex items-start justify-between mb-2"><div className="min-w-0"><h3 className="font-bold text-gray-800 truncate">{pt.name}</h3><p className="text-xs text-gray-500 mt-0.5">{pt.type}</p></div><div className="text-right shrink-0 ml-2"><p className="text-emerald-600 font-black text-lg">{fmt$(pt.price_per_hour)}</p><p className="text-xs text-gray-400">/hora</p></div></div><p className="text-xs text-gray-400 mb-3">{pt.custom_hours?'⏰ Horário próprio':'📋 Herda do estabelecimento'}</p>{canEdit&&<div className="flex gap-2"><Btn variant="secondary" size="sm" onClick={()=>openEdit(pt)}>Editar</Btn>{isAdmin&&<Btn variant="danger" size="sm" onClick={()=>setDelPt(pt)}>Excluir</Btn>}</div>}</div>)}{points.length===0&&<div className="col-span-3 text-center py-16 text-gray-400"><p className="text-4xl mb-2">📍</p><p>Nenhum ponto cadastrado</p></div>}</div><Modal open={showForm} onClose={()=>setShowForm(false)} title={editPt?'Editar Ponto':'Novo Ponto'} maxW="max-w-xl"><div className="space-y-4"><Field label="Estabelecimento" required><Sel value={f.est_id} onChange={e=>upd('est_id',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/></Field><Field label="Tipo de Espaço" required><Sel value={f.type} onChange={e=>upd('type',e.target.value)} options={ESTABLISHMENT_TYPES} placeholder="Selecione..."/></Field><Field label="Nome do Ponto" required><Inp value={f.name} onChange={e=>upd('name',e.target.value)}/></Field><Field label="Valor por hora (R$)" required><Inp type="number" value={f.price_per_hour} onChange={e=>upd('price_per_hour',Number(e.target.value))}/></Field><div className="bg-amber-50 border border-amber-100 rounded-xl p-3"><label className="flex items-start gap-2.5 cursor-pointer"><input type="checkbox" checked={customH} onChange={e=>setCustomH(e.target.checked)} className="w-4 h-4 accent-emerald-600 mt-0.5"/><div><p className="text-sm font-medium text-gray-700">Horário próprio para este ponto</p><p className="text-xs text-gray-400">Por padrão herda do estabelecimento</p></div></label></div>{customH&&<HoursEditor value={f.custom_hours||{...DEFAULT_HOURS}} onChange={v=>upd('custom_hours',v)}/>}<div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setShowForm(false)}>Cancelar</Btn><Btn className="flex-1" onClick={save}>Salvar</Btn></div></div></Modal><Modal open={!!delPt} onClose={()=>setDelPt(null)} title="Confirmar Exclusão"><p className="text-sm text-gray-600 mb-5">Excluir <strong>"{delPt?.name}"</strong>?</p><div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setDelPt(null)}>Cancelar</Btn><Btn variant="danger" className="flex-1" onClick={()=>del(delPt.id)}>Excluir</Btn></div></Modal></div>;
}

// ================================================================
// CRM USERS
// ================================================================
const ROLE_OPTS=[{value:'admin',label:'Administrador — acesso total'},{value:'manager',label:'Gerente — dashboard + reservas do est.'},{value:'simples',label:'Usuário Simples — somente reservas'}];
const ROLE_BADGE={admin:'blue',manager:'green',simples:'gray'};
const ROLE_NAME={admin:'Administrador',manager:'Gerente',simples:'Simples'};

function CRMUsers({crmUser,showToast}){
  const [users,setUsers]=useState([]);
  const [ests,setEsts]=useState([]);
  const [loading,setLoading]=useState(true);
  const [estSearch,setEstSearch]=useState('');
  const [showForm,setShowForm]=useState(false);
  const [editU,setEditU]=useState(null);
  const [f,setF]=useState({name:'',email:'',password:'',pw2:'',role:'manager',est_id:''});
  const [err,setErr]=useState({});
  const [delU,setDelU]=useState(null);
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const isAdmin=crmUser?.role==='admin';
  const ROLE_OPTS=isAdmin
    ?[{value:'admin',label:'Administrador — acesso total'},{value:'manager',label:'Gerente — vários estabelecimentos'},{value:'simples',label:'Usuário Simples — somente reservas'}]
    :[{value:'simples',label:'Usuário Simples — somente reservas'}];
  const needsEst=f.role!=='admin';

  const load=()=>{
    Promise.all([userApi.list(),estApi.list()]).then(([u,e])=>{setUsers(u);setEsts(e);}).catch(()=>{}).finally(()=>setLoading(false));
  };
  useEffect(()=>{load();},[]);

  const openNew=()=>{setF({name:'',email:'',password:'',pw2:'',role:isAdmin?'manager':'simples',est_id:ests[0]?.id||''});setEditU(null);setErr({});setShowForm(true);};
  const openEdit=(u)=>{setF({name:u.name,email:u.email,password:'',pw2:'',role:u.role,est_id:u.est_id||''});setEditU(u);setErr({});setShowForm(true);};

  const validate=()=>{
    const e={};
    if(!f.name)e.name='Obrigatório';
    if(!f.email)e.email='Obrigatório';
    if(!editU&&!f.password)e.password='Obrigatório';
    if(f.password&&f.password.length<6)e.password='Mínimo 6 caracteres';
    if(f.password&&f.password!==f.pw2)e.pw2='Senhas não coincidem';
    if(needsEst&&!f.est_id)e.est_id='Selecione um estabelecimento';
    setErr(e);return!Object.keys(e).length;
  };

  const save=async()=>{
    if(!validate())return;
    try{
      const payload={name:f.name,email:f.email,role:f.role,est_id:needsEst?f.est_id:null,...(f.password?{password:f.password}:{})};
      if(editU){await userApi.update(editU.id,payload);}else{await userApi.create({...payload,password:f.password});}
      showToast('Usuário salvo!','success');setShowForm(false);load();
    }catch(e){showToast(e.message,'error');}
  };

  const del=async(id)=>{
    try{await userApi.remove(id);showToast('Usuário excluído','info');setDelU(null);load();}
    catch(e){showToast(e.message,'error');}
  };

  if(loading)return<Spinner/>;

  return<div className="p-6"><div className="flex items-center justify-between mb-6"><h1 className="text-2xl font-black text-gray-900">Usuários do Sistema</h1><Btn onClick={openNew}>+ Novo Usuário</Btn></div>
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
    <table className="w-full text-sm"><thead className="bg-gray-50 border-b border-gray-100"><tr>{['Nome','Email','Perfil','Estabelecimento','Ações'].map(h=><th key={h} className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${h==='Ações'?'text-right':''}`}>{h}</th>)}</tr></thead>
    <tbody className="divide-y divide-gray-50">{users.map(u=><tr key={u.id} className="hover:bg-gray-50">
      <td className="px-4 py-3 font-semibold text-gray-800">{u.name}</td>
      <td className="px-4 py-3 text-gray-500">{u.email}</td>
      <td className="px-4 py-3"><Badge color={ROLE_BADGE[u.role]||'gray'}>{ROLE_NAME[u.role]||u.role}</Badge></td>
      <td className="px-4 py-3 text-gray-500 text-xs">{u.est_name||<span className="italic text-gray-300">—</span>}</td>
      <td className="px-4 py-3"><div className="flex gap-2 justify-end">{isAdmin&&<><Btn variant="secondary" size="sm" onClick={()=>openEdit(u)}>Editar</Btn><Btn variant="danger" size="sm" onClick={()=>setDelU(u)}>Excluir</Btn></>}</div></td>
    </tr>)}</tbody></table>
    {users.length===0&&<div className="text-center py-12 text-gray-400">Nenhum usuário</div>}
  </div>
  <Modal open={showForm} onClose={()=>setShowForm(false)} title={editU?'Editar Usuário':'Novo Usuário'}><div className="space-y-3">
    <Field label="Nome" required><Inp value={f.name} onChange={e=>upd('name',e.target.value)}/>{err.name&&<p className="text-xs text-red-500">{err.name}</p>}</Field>
    <Field label="Email" required><Inp type="email" value={f.email} onChange={e=>upd('email',e.target.value)}/>{err.email&&<p className="text-xs text-red-500">{err.email}</p>}</Field>
    <Field label="Perfil"><Sel value={f.role} onChange={e=>{upd('role',e.target.value);if(e.target.value==='admin')upd('est_id','');}} options={ROLE_OPTS}/></Field>
    {needsEst&&<Field label="Estabelecimento" required><Sel value={f.est_id} onChange={e=>upd('est_id',e.target.value)} options={ests.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/>{err.est_id&&<p className="text-xs text-red-500">{err.est_id}</p>}</Field>}
    <Field label={editU?'Nova senha (vazio = manter)':'Senha'} required={!editU}><Inp type="password" value={f.password} onChange={e=>upd('password',e.target.value)}/>{err.password&&<p className="text-xs text-red-500">{err.password}</p>}</Field>
    {f.password&&<Field label="Confirmar senha" required><Inp type="password" value={f.pw2} onChange={e=>upd('pw2',e.target.value)}/>{err.pw2&&<p className="text-xs text-red-500">{err.pw2}</p>}</Field>}
    <div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setShowForm(false)}>Cancelar</Btn><Btn className="flex-1" onClick={save}>Salvar</Btn></div>
  </div></Modal>
  <Modal open={!!delU} onClose={()=>setDelU(null)} title="Excluir Usuário"><p className="text-sm text-gray-600 mb-5">Excluir <strong>{delU?.name}</strong>?</p><div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setDelU(null)}>Cancelar</Btn><Btn variant="danger" className="flex-1" onClick={()=>del(delU.id)}>Excluir</Btn></div></Modal>
  </div>;
}

// ================================================================
// CRM RESERVATIONS
// ================================================================
function CRMReservations({showToast}){
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
  const MBL={name:'',phone:'',email:'',estId:'',pointId:'',date:'',slots:[],pm:'dinheiro'};
  const [mb,setMb]=useState(MBL);
  const [mbEsts,setMbEsts]=useState([]);
  const [mbPoints,setMbPoints]=useState([]);
  const [mbSlots,setMbSlots]=useState([]);
  const [mbSaving,setMbSaving]=useState(false);
  const updMb=(k,v)=>setMb(m=>({...m,[k]:v}));

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
    estApi.list().then(setMbEsts).catch(()=>{});
  },[showManual]);
  useEffect(()=>{
    if(!mb.estId){setMbPoints([]);updMb('pointId','');return;}
    pointApi.list(mb.estId).then(setMbPoints).catch(()=>{});
    updMb('pointId','');
  },[mb.estId]);
  useEffect(()=>{
    if(!mb.pointId||!mb.date){setMbSlots([]);updMb('slots',[]);return;}
    pointApi.slots(mb.pointId,mb.date).then(setMbSlots).catch(()=>setMbSlots([]));
    updMb('slots',[]);
  },[mb.pointId,mb.date]);



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
    if(!mb.name||!mb.phone||!mb.estId||!mb.pointId||!mb.date||!mb.slots.length){showToast('Nome, telefone e horário são obrigatórios','error');return;}
    const s=mb.slots[0];
    const e=`${String(parseInt(mb.slots[mb.slots.length-1])+1).padStart(2,'0')}:00`;
    setMbSaving(true);
    try{
      await resApi.manualCreate({
        point_id:Number(mb.pointId),est_id:Number(mb.estId),
        date:mb.date,start_time:s,end_time:e,hours:mb.slots.length,
        payment_method:mb.pm,client_name:mb.name,client_phone:mb.phone,client_email:mb.email||undefined,
      });
      showToast('Reserva criada com sucesso!','success');
      setShowManual(false);setMb(MBL);load();
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
  const mbTotal=mbPt&&mb.slots.length?mbPt.price_per_hour*mb.slots.length:0;

  return<div className="p-6">
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-black text-gray-900">Gestão de Reservas</h1>
      <Btn onClick={()=>{setShowManual(true);setMb(MBL);}}>+ Nova Reserva</Btn>
    </div>
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
            </div>
          </div>
          {r.status==='confirmed'&&<div className="flex gap-2 shrink-0">
            <Btn variant="secondary" size="sm" onClick={()=>{setReschRes(r);setNewDate('');setNewSlots([]);}}>Remarcar</Btn>
            <Btn variant="danger" size="sm" onClick={()=>handleCancel(r.id)}>Cancelar</Btn>
          </div>}
        </div>
      </div>)}
    </div>}

    {/* Modal Remarcar */}
    <Modal open={!!reschRes} onClose={()=>setReschRes(null)} title="Remarcar Reserva">{reschRes&&<div className="space-y-4"><div className="bg-gray-50 rounded-xl p-3 text-sm"><p className="font-semibold">{reschRes.point_name}</p><p className="text-gray-500">Atual: {fmtDate(dateStr(reschRes))} • {reschRes.start_time}–{reschRes.end_time}</p></div><Field label="Nova data"><input type="date" value={newDate} onChange={e=>{setNewDate(e.target.value);setNewSlots([]);}} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/></Field>{newDate&&<div><p className="text-sm font-medium text-gray-700 mb-2">Novo horário</p><div className="grid grid-cols-4 gap-1.5">{rSlots.map(s=><button key={s.time} onClick={()=>toggleSlot(s)} disabled={!s.available} className={`py-2 text-xs rounded-lg border font-medium ${newSlots.includes(s.time)?'bg-emerald-600 text-white border-emerald-600':s.available?'border-gray-300 hover:border-emerald-400 text-gray-700':'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'}`}>{s.time}</button>)}</div></div>}<div className="flex gap-3"><Btn variant="secondary" className="flex-1" onClick={()=>setReschRes(null)}>Cancelar</Btn><Btn className="flex-1" disabled={!newDate||!newSlots.length} onClick={handleReschedule}>Confirmar</Btn></div></div>}</Modal>

    {/* Modal Nova Reserva Manual */}
    <Modal open={showManual} onClose={()=>setShowManual(false)} title="Nova Reserva Manual" maxW="max-w-lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome completo" required>
            <Inp value={mb.name} onChange={e=>updMb('name',e.target.value)} placeholder="João Silva"/>
          </Field>
          <Field label="Telefone" required>
            <Inp value={mb.phone} onChange={e=>updMb('phone',e.target.value)} placeholder="(00) 00000-0000"/>
          </Field>
        </div>
        <Field label="Email (opcional)">
          <Inp value={mb.email} onChange={e=>updMb('email',e.target.value)} placeholder="email@cliente.com"/>
        </Field>
        <Field label="Estabelecimento" required>
          <Sel value={mb.estId} onChange={e=>updMb('estId',e.target.value)} options={mbEsts.map(e=>({value:e.id,label:e.name}))} placeholder="Selecione..."/>
        </Field>
        {mb.estId&&<Field label="Ponto / Espaço" required>
          <Sel value={mb.pointId} onChange={e=>updMb('pointId',e.target.value)} options={mbPoints.map(p=>({value:p.id,label:`${p.name} — ${fmt$(p.price_per_hour)}/h`}))} placeholder="Selecione..."/>
        </Field>}
        {mb.pointId&&<Field label="Data" required>
          <input type="date" value={mb.date} min={TODAY} onChange={e=>updMb('date',e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
        </Field>}
        {mb.date&&mb.pointId&&<div>
          <p className="text-sm font-medium text-gray-700 mb-2">Horários disponíveis</p>
          {mbSlots.length===0?<p className="text-sm text-gray-400 text-center py-3">Nenhum horário disponível</p>
          :<div className="grid grid-cols-4 gap-1.5">
            {mbSlots.map(s=><button key={s.time} onClick={()=>toggleMbSlot(s)} disabled={!s.available} className={`py-2 text-xs rounded-lg border font-medium ${mb.slots.includes(s.time)?'bg-emerald-600 text-white border-emerald-600':s.available?'border-gray-300 hover:border-emerald-400 text-gray-700':'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'}`}>{s.time}</button>)}
          </div>}
        </div>}
        {mb.slots.length>0&&<div className="bg-emerald-50 rounded-xl p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Período</span><span className="font-medium">{mbStartT} – {mbEndT}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Duração</span><span className="font-medium">{mb.slots.length}h</span></div>
          <div className="flex justify-between font-bold text-emerald-700 pt-1 border-t border-emerald-100"><span>Total</span><span>{fmt$(mbTotal)}</span></div>
        </div>}
        <Field label="Forma de pagamento">
          <Sel value={mb.pm} onChange={e=>updMb('pm',e.target.value)} options={PAY_OPTS}/>
        </Field>
        <div className="flex gap-3 pt-1">
          <Btn variant="secondary" className="flex-1" onClick={()=>setShowManual(false)}>Cancelar</Btn>
          <Btn className="flex-1" disabled={mbSaving||!mb.name||!mb.phone||!mb.slots.length} onClick={saveManual}>{mbSaving?'Salvando...':'Confirmar Reserva'}</Btn>
        </div>
      </div>
    </Modal>
  </div>;
}
// ================================================================
// MAIN APP
// ================================================================
export default function App(){
  const [view,setView]=useState('marketplace');
  const [page,setPage]=useState('mkt-home');
  const [pageArg,setPageArg]=useState(null);
  const [crmUser,setCrmUser]=useState(null);
  const [publicUser,setPublicUser]=useState(null);
  const [establishments,setEstablishments]=useState([]);
  const [points,setPoints]=useState([]);
  const [toast,setToast]=useState(null);
  const [showAuth,setShowAuth]=useState(false);
  const [authMode,setAuthMode]=useState('login');
  const [pendRes,setPendRes]=useState(null);
  const [confRes,setConfRes]=useState(null);
  const [confLoading,setConfLoading]=useState(false);

  const showToast=useCallback((message,type='success')=>{
    setToast({message,type});
    setTimeout(()=>setToast(null),3500);
  },[]);

  const navigate=(pg,arg=null)=>{
    setPage(pg);setPageArg(arg);window.scrollTo(0,0);
    if(pg==='crm-login'||pg.startsWith('crm-'))setView('crm');
    else if(pg==='password-recovery')setView('password-recovery');
    else setView('marketplace');
  };

  // Carrega dados do marketplace
  const loadMkt=useCallback(()=>{
    estApi.list().then(setEstablishments).catch(()=>{});
    pointApi.list().then(setPoints).catch(()=>{});
  },[]);
  useEffect(()=>{loadMkt();},[loadMkt]);

  // Restaura sessão do localStorage
  useEffect(()=>{
    const token=localStorage.getItem('token');
    const savedUser=localStorage.getItem('user');
    const savedType=localStorage.getItem('userType');
    if(token&&savedUser){
      try{
        const u=JSON.parse(savedUser);
        if(savedType==='crm')setCrmUser(u);
        else setPublicUser(u);
      }catch{}
    }
  },[]);

  // ── CRM Auth ──
  const crmLogin=async(email,pw)=>{
    const{token,user}=await authApi.crmLogin(email,pw);
    saveToken(token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('userType','crm');
    setCrmUser(user);navigate(user.role==='simples'?'crm-reservations':'crm-dashboard');
  };
  const crmLogout=()=>{
    clearToken();localStorage.removeItem('user');localStorage.removeItem('userType');
    setCrmUser(null);navigate('mkt-home');
  };

  // ── Public Auth ──
  const pubLogin=async(email,pw)=>{
    const{token,user}=await authApi.pubLogin(email,pw);
    saveToken(token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('userType','public');
    setPublicUser(user);setShowAuth(false);showToast(`Bem-vindo, ${user.name.split(' ')[0]}!`,'success');
    if(pendRes){setConfRes(pendRes);setPendRes(null);}
  };
  const pubRegister=async(name,cpf,email,password)=>{
    const{token,user}=await authApi.pubRegister(name,cpf,email,password);
    saveToken(token);localStorage.setItem('user',JSON.stringify(user));localStorage.setItem('userType','public');
    setPublicUser(user);setShowAuth(false);showToast('Conta criada com sucesso!','success');
    if(pendRes){setConfRes(pendRes);setPendRes(null);}
  };
  const pubLogout=()=>{
    clearToken();localStorage.removeItem('user');localStorage.removeItem('userType');
    setPublicUser(null);showToast('Saiu da conta','info');
  };

  // ── Reservas ──
  const handleReserve=(rd,needAuth)=>{
    if(needAuth){setPendRes(rd);setAuthMode('login');setShowAuth(true);return;}
    setConfRes(rd);
  };
  const confirmRes=async(paymentMethod)=>{
    const{pt,est,date,startT,endT,hours,total}=confRes;
    setConfLoading(true);
    try{
      await resApi.create({point_id:pt.id,est_id:est.id,date,start_time:startT,end_time:endT,hours,total,payment_method:paymentMethod||'dinheiro'});
      setConfRes(null);showToast('✅ Reserva confirmada! Email enviado.','success');
      navigate('my-reservations');
    }catch(e){showToast(e.message,'error');}finally{setConfLoading(false);}
  };

  // ── RENDER ──
  if(view==='password-recovery')return<><Toast toast={toast}/><PasswordRecovery navigate={navigate}/></>;

  if(view==='crm'){
    if(!crmUser)return<><Toast toast={toast}/><CRMLogin onLogin={crmLogin} navigate={navigate}/></>;
    const pages={
      'crm-dashboard':    <CRMDashboard/>,
      'crm-establishment':<CRMEstablishment showToast={showToast}/>,
      'crm-points':       <CRMPoints crmUser={crmUser} showToast={showToast}/>,
      'crm-users':        <CRMUsers crmUser={crmUser} showToast={showToast}/>,
      'crm-reservations': <CRMReservations showToast={showToast}/>,
    };
    return<><Toast toast={toast}/><CRMLayout crmUser={crmUser} page={page} navigate={navigate} onLogout={crmLogout}>{pages[page]||pages['crm-dashboard']}</CRMLayout></>;
  }

  const mktPage=()=>{
    switch(page){
      case 'est-detail':
        return<EstDetail estId={pageArg} points={points} navigate={navigate} publicUser={publicUser} onReserve={handleReserve}/>;
      case 'my-reservations':
        return publicUser
          ?<MyReservations publicUser={publicUser} navigate={navigate} showToast={showToast}/>
          :<div className="max-w-md mx-auto text-center py-24 px-4"><p className="text-5xl mb-4">🔐</p><p className="text-gray-600 mb-5">Você precisa estar logado para ver suas reservas.</p><Btn onClick={()=>{setAuthMode('login');setShowAuth(true);}}>Entrar na minha conta</Btn></div>;
      case 'public-auth':
        return<div className="min-h-[60vh] flex items-center justify-center p-4"><div className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-sm"><button onClick={()=>navigate('mkt-home')} className="text-sm text-gray-400 hover:text-gray-600 mb-4 block">← Voltar</button><AuthModal open={true} onClose={()=>navigate('mkt-home')} onLogin={pubLogin} onRegister={pubRegister} initialMode={pageArg||'login'}/></div></div>;
      default:
        return<MktHome establishments={establishments} points={points} navigate={navigate}/>;
    }
  };

  return<div className="min-h-screen bg-gray-50">
    <Toast toast={toast}/>
    <MktHeader publicUser={publicUser} page={page} navigate={navigate} onLogout={pubLogout}/>
    {mktPage()}
    <AuthModal open={showAuth} onClose={(a)=>{setShowAuth(false);setPendRes(null);if(a==='forgot')navigate('password-recovery');}} onLogin={pubLogin} onRegister={pubRegister} initialMode={authMode}/>
    <ResConfirmModal open={!!confRes&&!!publicUser} data={confRes} publicUser={publicUser} onConfirm={confirmRes} onClose={()=>setConfRes(null)} loading={confLoading}/>
  </div>;
}
