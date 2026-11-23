var groups = $.dictionary.getGroups();
var cls = $.dictionary.getClasses(groups[0].length ? groups[0] : '');
var lines = [];
function h(x) { var s = ''; try { s = x.description || x.help || ''; } catch (e) {} return s ? '  // ' + String(s).replace(/\s+/g, ' ').slice(0, 160) : ''; }
function args(m) { var a = []; try { for (var k = 0; k < m.arguments.length; k++) a.push(m.arguments[k].name + ':' + m.arguments[k].dataType); } catch (e) {} return a.join(', '); }
for (var c = 0; c < cls.length; c++) {
  var name = String(cls[c]).split('\t')[0];
  var r = $.dictionary.getClass(name);
  if (!r) continue;
  lines.push('class ' + name + h(r));
  var sp = [];
  for (var i = 0; i < r.staticProperties.length; i++) { var p = r.staticProperties[i]; if (/^(COMMAND_|CHANNELLAYOUT_|AUDIOCHANNELLABEL_)/.test(p.name)) continue; sp.push(p.name); }
  if (sp.length) lines.push('  static: ' + sp.join(', '));
  for (var j = 0; j < r.staticMethods.length; j++) { var sm = r.staticMethods[j]; if (/^(addEventListener|removeEventListener|dispatchEvent|__)$/.test(sm.name)) continue; lines.push('  static ' + sm.name + '(' + args(sm) + ')' + (sm.dataType ? ':' + sm.dataType : '') + h(sm)); }
  for (var k2 = 0; k2 < r.properties.length; k2++) { var q = r.properties[k2]; lines.push('  .' + q.name + ':' + q.dataType + (q.type === 'readonly' ? ' (ro)' : '') + h(q)); }
  for (var m2 = 0; m2 < r.methods.length; m2++) { var mm = r.methods[m2]; lines.push('  ' + mm.name + '(' + args(mm) + ')' + (mm.dataType ? ':' + mm.dataType : '') + h(mm)); }
}
var f = new File(Folder.temp.fsName + '/au-dict.txt'); f.encoding = 'UTF-8'; f.open('w'); f.write(lines.join('\n')); f.close();
return { classes: cls.length, lines: lines.length, file: f.fsName };
