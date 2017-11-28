'use strict';

var _ = require('lodash');

// Specify v2: Get all properties for an object (console.dir):
module.exports.specify = function (obj) {
	const getValueDescription = function (val) {
		const objectType = Object.prototype.toString.call(val).replace('[object ', '').replace(']', '');
		switch (objectType) {
			case 'Object': return '{' + _.keys(val).slice(0, 7).join() + '}';
			case 'String': return val.slice(0, 50);
			case 'Array': return 'Array[' + val.length + ']';
			case 'Function':
			case 'Null':
				return objectType.toLowerCase();
			default: return objectType + (':' + val).slice(0, 50);
		}
	}
	return _.isObjectLike(obj) ? _.mapValues(obj, val => getValueDescription(val)) : getValueDescription(obj);
};

module.exports.toSlug = function (str, removeInternationalChars) {
	// Abort if not a proper string value
	if (!str || typeof(str) !== 'string')
		return str;
	// For both
	var newStr = str.trim()
		.toLowerCase()
		.replace(/ /g, '-') // space to dash
		.replace(/_/g, '-') // underscore to dash
	// Remove ÅÄÖ etc?
	if (removeInternationalChars) {
		newStr = newStr.replace(/[^\w-]+/g,''); // remove all other characters incl. ÅÄÖ
	}
	else {
		newStr = newStr.replace(/[\t.,?;:‘’“”"'`!@#$€%^&§°*<>()\[\]{}_\+=\/\|\\]/g,''); // remove invalid characters but keep ÅÄÖ etc
	}
	// For both
	newStr = newStr.replace(/---/g,'-') // fix for the ' - ' case
		.replace(/--/g,'-') // fix for the '- ' case
		.replace(/--/g,'-'); // fix for the '- ' case
	return newStr;
};

module.exports.toJsonIfNeeded = obj => obj.toJSON ? obj = obj.toJSON() : obj;

// [{ reference: foo, ... }, { reference: bar, ... }] -> { foo: ..., bar: ... }
module.exports.arrayToCollection = (array, keyField='reference') => _.reduce(array, (collection, obj) => { collection[obj[keyField]] = obj; return collection; }, {});
_.mixin({ 'arrayToCollection': module.exports.arrayToCollection });

// applyToAll(func, obj1) or applyToAll(func, [obj1, obj2, ...])
module.exports.applyToAll = (func, objectOrArray) => Array.isArray(objectOrArray) ? _.map(objectOrArray, func) : func(objectOrArray);
_.mixin({ 'applyToAll': module.exports.applyToAll });

// Simple JSON response, usage e.g.
// 1. helpers.sendResponse.bind(res) - err, results will be appended to end
// 2. .find((err, results) => helpers.sendResponse.call(res, err, results))
module.exports.sendResponse = function (err, results, callback) {
	const errorCode = err
		? err.statusCode || 400
		: (results === undefined || results === null)
			? 404
			: 200;
	//console.log('sendResponse', errorCode, err, results, typeof(callback));
	if (errorCode !== 200) {
		return this.status(errorCode).send({ code: errorCode, message: _.get(err, 'message'), error: err });
	}
	else {
		if (typeof(callback) === 'function') {
			callback(results);
		}
		else if (results.toJSON) {
			return this.json(results.toJSON());
		}
		else {
			return this.json(results);
		}
	}
};

module.exports.sendRequestResponse = function (req, res, next) {
	module.exports.sendResponse.call(res, null, req.crudify.result);
};

module.exports.stripIdsFromRet = function (doc, ret, options) {
	delete ret._id;
	delete ret.__v;
};

// E.g. populate user.account with full Account structure
// helpers.populateProperties.bind(this, 'user', 'account')
module.exports.populateProperties = function ({modelName, propertyName, afterPopulate}, req, res, next) {
	req.crudify[modelName].populate(propertyName, '-_id -__v', next);
};

// From reference to MongoDB _id (or multiple _id's)
// E.g. user.account = 'my-company' --> user.account = '594e6f880ca23b37a4090fe0'
// helpers.changeReferenceToId.bind(this, 'Service', 'reference', 'services')
module.exports.changeReferenceToId = function ({modelName, parentCollection, childIdentifier}, req, res, next) {
	const modelObj = require('mongoose').model(modelName);
	let searchQuery = {};
	let lookupAction = 'find';
	const parentCollectionType = Object.prototype.toString.call(req.body[parentCollection]);
	switch (parentCollectionType) {
		case '[object String]': // One identifier
			searchQuery[childIdentifier] = req.body[parentCollection];
			break;
		case '[object Array]': // Array of identifiers
			searchQuery[childIdentifier] = { $in: req.body[parentCollection] };
			break;
		case '[object Object]': // Create new child object, e.g. create User and
			lookupAction = 'create';
			searchQuery = req.body[parentCollection];
			break;
	}
	// Do the find or create, depending on lookupAction
	modelObj[lookupAction](searchQuery, function (err, results) {
		if (!err) {
			if (results) {
				switch (parentCollectionType) {
					case '[object String]': // One identifier
						req.body[parentCollection] = results[0]._id;
						break;
					case '[object Array]': // Array of identifiers
						req.body[parentCollection] = _.map(results, '_id');
						break;
					case '[object Object]': // Create new child object, e.g. create User and
						req.body[parentCollection] = results._id;
						break;
				}
			}
			else {
				res.status(404);
				err = modelName + '(s) not found: ' + req.body[parentCollection];
			}
		}
		next(err, results);
	});
};

module.exports.dateInDays = days => new Date((new Date()).getTime() + days*24*60*60*1000).getTime();
module.exports.dateIn1Month = () => module.exports.dateInDays(31);
module.exports.dateIn1Year = () => module.exports.dateInDays(366);

module.exports.isSubscriptionActive = sub => sub.dateExpires > Date.now() && sub.dateStopped === undefined;
