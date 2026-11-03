/** Export only rendered answer content; omit interactive controls from copied HTML. */
export function answerClipboard(element:HTMLElement){
 const copy=element.cloneNode(true) as HTMLElement;
 copy.querySelectorAll('button,summary').forEach(node=>node.remove());
 copy.querySelectorAll('details').forEach(node=>node.replaceWith(...node.childNodes));
 // Reading text from the mounted answer also includes collapsed controls. Build
 // an explicit plain-text form from the clean tree instead.
 const html=copy.innerHTML;
 copy.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));
 copy.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote').forEach(node=>node.append('\n'));
 copy.querySelectorAll('td,th').forEach(node=>node.append('\t'));
 return{html,text:(copy.textContent??'').replace(/\n{3,}/g,'\n\n').trim()};
}
