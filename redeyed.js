'use strict';
/*jshint laxbreak: true */

var esprima  =  require('esprima')
  , util     =  require('util')
  , toString =  Object.prototype.toString
  ;

function inspect (obj) {
  return util.inspect(obj, false, 5, true);
}

function isString (obj) {
  return toString.call(obj) == '[object String]';
}

function isNumber (obj) {
  return toString.call(obj) == '[object Number]';
}

function isObject (obj) {
  return toString.call(obj) == '[object Object]';
}

function isFunction (obj) {
  return toString.call(obj) == '[object Function]';
}

function surroundWith (before, after) {
  return function (s) { return before + s + after; };
}

function isNonCircular(key) { 
  return key !== '_parent'; 
}

function objectizeString (value) {
  var vals = value.split(':');

  if (0 === vals.length || vals.length > 2) 
    throw new Error(
      'illegal string config: ' + value +
      '\nShould be of format "before:after"'
    );

  if (vals.length === 1 || vals[1].length === 0) {
    return vals.indexOf(':') < 0 ? { _before: vals[0] } : { _after: vals[0] };
  } else {
    return { _before: vals[0], _after: vals[1] };
  }
}

function objectize (node) {

  // Converts 'bef:aft' to { _before: bef, _after: aft } 
  // and resolves undefined before/after from parent or root

  function resolve (value, key) {
    // resolve before/after from root or parent if it isn't present on the current node
    if (!value._parent) return undefined;
    
    // Immediate parent
    if (value._parent._default && value._parent._default[key]) return value._parent._default[key];

    // Root
    var root = value._parent._parent;
    if (!root) return undefined;

    return root._default ? root._default[key] : undefined;
  }

  function process (key) {
    var value = node[key];

    if (!value) return;
    if (isFunction(value)) return;

    // normalize all strings to objects
    if (isString(value)) {
      node[key] = value = objectizeString(value);
    }
    
    value._parent = node;
    if (isObject(value)) {
      if (!value._before && !value._after) return objectize (value);

      // resolve missing _before or _after from parent(s) 
      // in case we only have either one on this node
      value._before =  value._before || resolve(value, '_before');
      value._after  =  value._after  || resolve(value, '_after');
      
      return;
    } 

    throw new Error('nodes need to be either {String}, {Object} or {Function}.' + value + ' is neither.');
  }

  // Process _default ones first so children can resolve missing before/after from them
  if (node._default) process('_default');

  Object.keys(node)
    .filter(function (key) {
      return isNonCircular(key) 
        && node.hasOwnProperty(key)
        && key !== '_before' 
        && key !== '_after' 
        && key !== '_default';
    })
    .forEach(process);
}

function functionize (node) {
  Object.keys(node)
    .filter(function (key) { 
      return isNonCircular(key) && node.hasOwnProperty(key);
    })
    .forEach(function (key) {
      var value = node[key];

      if (isFunction(value)) return;

      if (isObject(value)) {

        if (!value._before && !value._after) return functionize(value);

        // at this point before/after were "inherited" from the parent or root
        // (see objectize)
        var before = value._before || '';
        var after = value._after || '';

        return node[key] = surroundWith (before, after);
      }
    });
}

function normalize (root) {
  objectize(root);
  functionize(root);
}

function mergeTokensAndComments(tokens, comments) {
  var all = {};

  function addToAllByRangeStart(t) { all[ t.range[0] ] = t; }

  tokens.forEach(addToAllByRangeStart);
  comments.forEach(addToAllByRangeStart);

  // keys are sorted automatically
  return Object.keys(all)
    .map(function (k) { return all[k]; });
}

function redeyed (code, config, opts) {
  opts = opts || {};

  // remove shebang
  code = code.replace(/^\#\!.*/, '');

  var ast = esprima.parse(code, { tokens: true, comment: true, range: true, tolerant: true })
    , tokens = ast.tokens
    , comments = ast.comments
    , lastSplitEnd = 0
    , splits = []
    , transformedCode
    , all
    ;

  // console.log(inspect(tokens));

  normalize(config);

  function addSplit (start, end, surround, tokenIdx, tokens) {
    var result
      , skip = 0;

    if (start >= end) return;
    if (surround) {
      // TODO: extra function to have no nested if
      result = surround(code.slice(start, end), tokenIdx, tokens);
      if (isObject(result)) {
        splits.push(result.replacement);
        skip = result.skip;
      } else 
        splits.push(result);

    } else
      splits.push(code.slice(start, end));

    // TODO: protect against running out of tokens
    lastSplitEnd = skip > 0 ? tokens[tokenIdx + skip].range[1] : end;
    return skip;
  }

  all = mergeTokensAndComments(tokens, comments);
  for (var tokenIdx = 0; tokenIdx < all.length; tokenIdx++) {
    var token = all[tokenIdx]
      , surroundForType = config[token.type]
      , surround
      , start
      , end;
     
    // At least the type (e.g., 'Keyword') needs to be specified for the token to be surrounded
    if (surroundForType) {

      // root defaults are only taken into account while resolving before/after otherwise
      // a root default would apply to everything, even if no type default was specified
      surround = surroundForType 
        && surroundForType.hasOwnProperty(token.value) 
        && surroundForType[token.value]
        && isFunction(surroundForType[token.value])
          ? surroundForType[token.value] 
          : surroundForType._default;

      start = token.range[0];
      end = token.range[1];

      addSplit(lastSplitEnd, start);
      tokenIdx += addSplit(start, end, surround, tokenIdx, all);
    }
  }

  if (lastSplitEnd < code.length) {
    addSplit(lastSplitEnd, code.length);
  }

  transformedCode = opts.nojoin ? undefined : splits.join('');

  return { 
      ast      :  ast
    , tokens   :  tokens
    , comments :  comments
    , splits   :  splits
    , code     :  transformedCode
  };
}

module.exports = redeyed;
