//
// Name:    subscriptions.js
// Purpose: Controller and routing for subscriptions (Account has Plans)
// Creator: Tom Söderlund
//

'use strict';

const _ = require('lodash');
const async = require('async');
const express = require('express');
const mongooseCrudify = require('mongoose-crudify');

const helpers = require('../../config/helpers');
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'stripe';
const paymentProvider = require('../../paymentProviders/' + PAYMENT_PROVIDER);

const Account = require('mongoose').model('Account');
const User = require('mongoose').model('User');
const Plan = require('mongoose').model('Plan');

const getAccountThen = function (req, res, callback) {
	const query = { reference: req.params.accountReference || req.params.userReference };
	// accountReference provided
	if (req.params.accountReference) {
		Account.findOne(query).exec(callback);
	}
	// userReference provided
	else if (req.params.userReference) {
		User.findOne(query).exec((err, user) => {
			Account.findById(user.account).exec(callback);
		});
	}	
};

// TODO: update to use Plan.allowMultiple instead (e.g. multiple domains)
const stopOtherSubscriptions = (oldSubscriptions, newSubscription) => {
	if (process.env.MULTIPLE_SUBSCRIPTIONS !== 'yes') {
		_.forEach(oldSubscriptions, sub => {
			sub.dateStopped = Date.now();
			// TODO: also stop in Stripe
		})
	}
}

const subscriptions = {

	list: function (req, res, next) {
		getAccountThen(req, res, account => res.json(account.subscriptions));
	},

	read: function (req, res, next) {
		res.json({});
	},

	create: function (req, res, next) {

		const createPaymentProviderSubscription = function (account, cb) {
			paymentProvider.createSubscription(
				/* user */ { reference: req.params.userReference },
				/* account */ account,
				/* subscription */ { plan: req.body.plan, billing: req.body.billing },
				/* payment */ { token: req.body.token, /* taxPercent: */ },
				cb
			);
		};

		const getPlanId = function (user, account, subscription, cb) {
			helpers.changeReferenceToId({ modelName:'Plan', parentCollection:'plan', childIdentifier:'reference' }, { body: subscription }, res, (err, plan) => cb(err, account, subscription));
		};

		const addSubscription = function (account, subscription, cb) {
			subscription.dateExpires = req.body.billing === 'year' ? helpers.dateIn1Year() : helpers.dateIn1Month();
			stopOtherSubscriptions(account.subscriptions, subscription);
			account.subscriptions.push(helpers.toJsonIfNeeded(subscription));
			account.save(cb);
		};

		const sendResponse = function (err, accountSaved) {
			helpers.sendResponse.call(res, err, _.get(accountSaved, 'subscriptions'));
		};

		async.waterfall([
				getAccountThen.bind(this, req, res),
				createPaymentProviderSubscription,
				getPlanId,
				addSubscription,
			],
			sendResponse
		);

	},

	update: function (req, res, next) {
		getAccountThen(req, res, account => {
			const subscriptionIndex = _.findIndex(account.subscriptions, sub => sub._id.toString() === req.params.subscriptionId);
			if (subscriptionIndex >= 0) {
				_.merge(account.subscriptions[subscriptionIndex], req.body);
			}
			account.save((err, results) => helpers.sendResponse.call(res, err, account.subscriptions[subscriptionIndex]));
		});
	},

	delete: function (req, res, next) {
		getAccountThen(req, res, account => {
			let subsStopped = 0;
			_.forEach(account.subscriptions, sub => {
				if (req.params.subscriptionId === undefined // stop all
					|| sub._id.toString() === req.params.subscriptionId) // stop one
				{
					sub.dateStopped = Date.now();
					subsStopped++;
				}
			});
			account.save((err, results) => helpers.sendResponse.call(res, err, { message: `Stopped ${subsStopped} subscriptions` }));
		});
	},

	extend: function (req, res, next) {
		paymentProvider.receiveExtendSubscription(req, function (err, customerId, subscriptionId, periodToExtend) {
			if (!err) {
				const query = { 'metadata.stripeCustomer': customerId };
				Account.findOne(query).exec((accountErr, account) => {
					if (!accountErr && account) {
						const matchingSubs = _.chain(account.subscriptions).filter(sub => _.get(sub, 'metadata.stripeSubscription') === subscriptionId).value();
						matchingSubs.forEach(sub => {
							sub.dateExpires = periodToExtend === 'year' ? helpers.dateIn1Year() : helpers.dateIn1Month();
						});
						account.save();
						res.send({ message: `Updated account and ${matchingSubs.length} subscription(s)` });
					}
					else {
						res.send({ message: 'Account not found' });
					}
				});
			}
			else {
				res.send({ message: err });
			}
		})
	},

}

module.exports = function (app, config) {

	const router = express.Router();
	app.use('/', router);

	// CRUD routes: Account
	router.get('/api/accounts/:accountReference/subscriptions', subscriptions.list);
	router.get('/api/accounts/:accountReference/subscriptions/:subscriptionId', subscriptions.read);
	router.post('/api/accounts/:accountReference/subscriptions', subscriptions.create);
	router.put('/api/accounts/:accountReference/subscriptions/:subscriptionId', subscriptions.update);
	router.delete('/api/accounts/:accountReference/subscriptions/:subscriptionId', subscriptions.delete);
	router.delete('/api/accounts/:accountReference/subscriptions', subscriptions.delete);

	// CRUD routes: User
	router.get('/api/users/:userReference/subscriptions', subscriptions.list);
	router.get('/api/users/:userReference/subscriptions/:subscriptionId', subscriptions.read);
	router.post('/api/users/:userReference/subscriptions', subscriptions.create);
	router.put('/api/users/:userReference/subscriptions/:subscriptionId', subscriptions.update);
	router.delete('/api/users/:userReference/subscriptions/:subscriptionId', subscriptions.delete);
	router.delete('/api/users/:userReference/subscriptions', subscriptions.delete);

	// Receive webhook from e.g. Stripe
	router.post('/api/subscriptions/extend', subscriptions.extend);

};